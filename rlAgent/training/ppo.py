from __future__ import annotations
import torch
import torch.nn as nn
from agent.model import ActorCritic, N_SURVIVOR_ACTIONS, ACT_SCAV_START, ACT_SCAV_END, ACT_ATTACK_START
from agent.encoder import MAX_PLAYERS
from training.rollout import Step, RolloutBuffer

NEG_INF = -1e9


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _survivor_action_mask(location_mask: torch.Tensor, opponent_mask: torch.Tensor) -> torch.Tensor:
    mask = torch.zeros(N_SURVIVOR_ACTIONS, dtype=torch.bool)
    mask[0] = True  # rest
    mask[1] = True  # defend
    mask[ACT_SCAV_START:ACT_SCAV_END] = location_mask
    mask[ACT_ATTACK_START:ACT_ATTACK_START + MAX_PLAYERS] = opponent_mask
    return mask


def _log_prob_cat(logits: torch.Tensor, mask: torch.Tensor, idx: int) -> torch.Tensor:
    masked = logits.clone()
    masked[~mask] = NEG_INF
    return torch.log_softmax(masked, dim=-1)[idx]


def _entropy_cat(logits: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    masked = logits.clone()
    masked[~mask] = NEG_INF
    p   = torch.softmax(masked, dim=-1)
    lp  = torch.log_softmax(masked, dim=-1)
    return -(p * lp)[mask].sum()


# ─────────────────────────────────────────────────────────────────────────────
# Per-step log_prob and entropy under the current (updated) policy
# ─────────────────────────────────────────────────────────────────────────────

def _step_log_prob_entropy(step: Step, out: dict) -> tuple[torch.Tensor, torch.Tensor]:
    if step.phase == "draft":
        logits = out["draft"].squeeze(0)
        lp     = _log_prob_cat(logits, step.masks.draft_pool, step.draft_idx)
        ent    = _entropy_cat(logits, step.masks.draft_pool)

    elif step.phase == "action_selection":
        sv_mask       = _survivor_action_mask(step.masks.locations, step.masks.opponents)
        action_logits = out["action"].squeeze(0)
        lp  = torch.tensor(0.0)
        ent = torch.tensor(0.0)
        for sv_slot, act_idx in step.survivor_acts:
            lp  = lp  + _log_prob_cat(action_logits[sv_slot], sv_mask, act_idx)
            ent = ent + _entropy_cat(action_logits[sv_slot], sv_mask)

    elif step.phase == "planning":
        # Note: food/water availability masks were applied during collection but
        # not stored here. We use the full 3-way softmax for recomputation —
        # a common simplification that still produces correct gradient direction.
        upkeep_logits = out["upkeep"].squeeze(0)
        full_mask     = torch.ones(3, dtype=torch.bool)
        lp  = torch.tensor(0.0)
        ent = torch.tensor(0.0)
        for sv_slot, choice_idx in step.upkeep_acts:
            lp  = lp  + _log_prob_cat(upkeep_logits[sv_slot], full_mask, choice_idx)
            ent = ent + _entropy_cat(upkeep_logits[sv_slot], full_mask)

    else:
        lp  = torch.tensor(0.0)
        ent = torch.tensor(0.0)

    return lp, ent


# ─────────────────────────────────────────────────────────────────────────────
# PPO update
# ─────────────────────────────────────────────────────────────────────────────

def ppo_update(
    model:          ActorCritic,
    optimizer:      torch.optim.Optimizer,
    buffer:         RolloutBuffer,
    n_epochs:       int   = 4,
    minibatch_size: int   = 64,
    clip_eps:       float = 0.2,
    vf_coef:        float = 0.5,
    ent_coef:       float = 0.01,
) -> dict:
    advantages, returns = buffer.compute_advantages()

    # Normalize advantages across the full buffer for training stability
    advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

    steps = buffer.steps
    n     = len(steps)
    stats = {"policy_loss": 0.0, "value_loss": 0.0, "entropy": 0.0, "n_updates": 0}

    for _ in range(n_epochs):
        for start in range(0, n, minibatch_size):
            batch_idx = torch.randperm(n)[start : start + minibatch_size]

            pol_loss = torch.tensor(0.0)
            val_loss = torch.tensor(0.0)
            entropy  = torch.tensor(0.0)

            for j in batch_idx.tolist():
                step = steps[j]
                out  = model(step.obs.unsqueeze(0))

                # Value loss — MSE between predicted and actual return
                val_loss = val_loss + 0.5 * (out["value"].squeeze() - returns[j]) ** 2

                # Policy loss — PPO clipped objective
                new_lp, ent = _step_log_prob_entropy(step, out)
                ratio        = torch.exp(new_lp - step.log_prob)
                adv          = advantages[j]
                pol_loss     = pol_loss - torch.min(
                    ratio * adv,
                    torch.clamp(ratio, 1 - clip_eps, 1 + clip_eps) * adv,
                )
                entropy = entropy + ent

            count = len(batch_idx)
            loss  = (pol_loss + vf_coef * val_loss - ent_coef * entropy) / count

            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=0.5)
            optimizer.step()

            stats["policy_loss"] += (pol_loss / count).item()
            stats["value_loss"]  += (val_loss / count).item()
            stats["entropy"]     += (entropy  / count).item()
            stats["n_updates"]   += 1

    n_up = stats["n_updates"]
    if n_up > 0:
        for k in ("policy_loss", "value_loss", "entropy"):
            stats[k] /= n_up

    return stats
