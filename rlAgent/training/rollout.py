from __future__ import annotations
from dataclasses import dataclass, field
import torch
from agent.encoder import Masks


@dataclass
class Step:
    obs:        torch.Tensor
    masks:      Masks
    phase:      str           # 'draft' | 'action_selection' | 'upkeep'
    player_idx: int

    # Phase-specific action, stored as indices into model output dims
    draft_idx:     int                   = -1
    survivor_acts: list[tuple[int, int]] = field(default_factory=list)  # [(sv_slot, act_idx), ...]
    upkeep_acts:   list[tuple[int, int]] = field(default_factory=list)  # [(sv_slot, choice_idx), ...]

    log_prob: float = 0.0
    value:    float = 0.0
    reward:   float = 0.0
    done:     bool  = False


class RolloutBuffer:
    """
    Collects Steps across multiple game episodes.
    Each episode ends with finish_episode(), which assigns per-player rewards
    and marks each player's last step as terminal.
    compute_advantages() runs GAE across all stored steps before the PPO update.
    """

    def __init__(self, gamma: float = 1.0, gae_lambda: float = 0.95):
        self.gamma      = gamma
        self.gae_lambda = gae_lambda
        self.steps:      list[Step] = []
        self._ep_starts: list[int]  = []

    # ── Collection ─────────────────────────────────────────────────────────────

    def start_episode(self) -> None:
        self._ep_starts.append(len(self.steps))

    def add(self, step: Step) -> None:
        self.steps.append(step)

    def finish_episode(self, rewards_by_player: dict[int, float]) -> None:
        """
        Assign rewards to all steps in the most recent episode and mark
        each player's last step as done (so GAE bootstraps with 0 there).
        """
        start = self._ep_starts[-1]

        last_for_player: dict[int, int] = {}
        for i in range(start, len(self.steps)):
            last_for_player[self.steps[i].player_idx] = i

        for i in range(start, len(self.steps)):
            s        = self.steps[i]
            s.reward = rewards_by_player.get(s.player_idx, 0.0)
            s.done   = (i == last_for_player.get(s.player_idx))

    # ── Advantage computation ──────────────────────────────────────────────────

    def compute_advantages(self) -> tuple[torch.Tensor, torch.Tensor]:
        """
        GAE with per-player running estimates.
        Each player's trajectory is independent — we track last_gae and last_val
        per player as we scan backwards through the interleaved steps.
        """
        n          = len(self.steps)
        advantages = torch.zeros(n)
        returns    = torch.zeros(n)

        last_gae: dict[int, float] = {}
        last_val: dict[int, float] = {}

        for i in reversed(range(n)):
            s = self.steps[i]
            p = s.player_idx

            next_val = 0.0 if s.done else last_val.get(p, 0.0)
            delta    = s.reward + self.gamma * next_val - s.value
            gae      = delta + self.gamma * self.gae_lambda * (0.0 if s.done else last_gae.get(p, 0.0))

            last_gae[p] = gae
            last_val[p] = s.value

            advantages[i] = gae
            returns[i]    = gae + s.value

        return advantages, returns

    # ── Housekeeping ───────────────────────────────────────────────────────────

    def clear(self) -> None:
        self.steps.clear()
        self._ep_starts.clear()

    def __len__(self) -> int:
        return len(self.steps)
