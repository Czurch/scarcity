import torch
import torch.nn as nn

from .encoder import OBS_SIZE, MAX_PLAYERS, MAX_SURVIVORS, MAX_DRAFT_POOL, LOCATION_IDS

# ─────────────────────────────────────────────────────────────────────────────
# Action space constants
# Action slots per survivor: 0=rest, 1=defend, 2..10=scavenge loc, 11..14=attack player
# ─────────────────────────────────────────────────────────────────────────────

ACT_REST         = 0
ACT_DEFEND       = 1
ACT_SCAV_START   = 2
ACT_SCAV_END     = 2 + len(LOCATION_IDS)           # exclusive: 11
ACT_ATTACK_START = ACT_SCAV_END                     # 11
ACT_ATTACK_END   = ACT_SCAV_END + MAX_PLAYERS       # 15

N_SURVIVOR_ACTIONS = ACT_ATTACK_END                 # 15
MAX_LOOT_TOKENS    = 8                              # max revealed tokens we encode


class ActorCritic(nn.Module):
    """
    Shared-trunk actor-critic for Scarcity.
    One forward pass produces logits for every decision type plus a state value.
    Only the logits relevant to the current phase are used each turn.
    """

    def __init__(self, hidden: int = 256):
        super().__init__()

        self.trunk = nn.Sequential(
            nn.Linear(OBS_SIZE, 512),
            nn.LayerNorm(512),
            nn.ReLU(),
            nn.Linear(512, hidden),
            nn.LayerNorm(hidden),
            nn.ReLU(),
        )

        self.draft_head    = nn.Linear(hidden, MAX_DRAFT_POOL)
        self.action_head   = nn.Linear(hidden, MAX_SURVIVORS * N_SURVIVOR_ACTIONS)
        self.loot_head     = nn.Linear(hidden, MAX_LOOT_TOKENS)
        self.upkeep_head   = nn.Linear(hidden, MAX_SURVIVORS * 3)  # food / water / none
        self.med_heal_head = nn.Linear(hidden, MAX_SURVIVORS)      # binary per survivor
        self.value_head    = nn.Linear(hidden, 1)

    def forward(self, obs: torch.Tensor) -> dict:
        """
        obs: [..., OBS_SIZE]
        Returns a dict with keys: draft, action, loot, upkeep, med_heal, value.
        Leading dims match obs.
        """
        batch = obs.shape[:-1]
        h = self.trunk(obs)

        return {
            "draft":    self.draft_head(h).view(*batch, MAX_DRAFT_POOL),
            "action":   self.action_head(h).view(*batch, MAX_SURVIVORS, N_SURVIVOR_ACTIONS),
            "loot":     self.loot_head(h).view(*batch, MAX_LOOT_TOKENS),
            "upkeep":   self.upkeep_head(h).view(*batch, MAX_SURVIVORS, 3),
            "med_heal": self.med_heal_head(h).view(*batch, MAX_SURVIVORS),
            "value":    self.value_head(h),
        }

    def get_value(self, obs: torch.Tensor) -> torch.Tensor:
        return self.value_head(self.trunk(obs))
