import { GameEngine } from '../GameEngine';
import { GameConfig } from '../types';
import { Transport } from './transport';

export async function runSession(config: GameConfig, transport: Transport, gameId: string): Promise<void> {
  const engine = new GameEngine(config);

  for (const player of engine.getState().players.filter((p) => p.isAgent)) {
    await transport.send({
      type: 'game_start',
      gameId,
      playerId: player.id,
      playerName: player.name,
      state: engine.getState(),
    });
  }

  while (!engine.isGameOver()) {
    engine.autoAdvance();

    if (!engine.isWaitingForAgent()) continue;

    const state = engine.getState();

    switch (state.phase) {
      case 'draft': {
        const drafter = engine.getCurrentDrafter();
        if (!drafter?.isAgent) break;
        await transport.send({ type: 'draft_request', gameId, playerId: drafter.id, state });
        const res = await transport.receive();
        if (res.type === 'draft_response') engine.draftPick(res.playerId, res.survivorId);
        break;
      }

      case 'planning': {
        const pending = state.players.find(
          (p) => p.isAgent && !p.isEliminated && !state.planningAllocations[p.id],
        );
        if (!pending) break;
        await transport.send({ type: 'planning_request', gameId, playerId: pending.id, state });
        const res = await transport.receive();
        if (res.type === 'planning_response') engine.submitPlanning(res.playerId, res.allocations);
        break;
      }

      case 'action_selection': {
        const pending = state.players.find((p) => p.isAgent && !p.isEliminated && !p.intentsSubmitted);
        if (!pending) break;
        await transport.send({ type: 'action_request', gameId, playerId: pending.id, state });
        const res = await transport.receive();
        if (res.type === 'action_response') engine.submitIntents(res.playerId, res.intents);
        break;
      }

      case 'looting': {
        const opp = state.lootOpportunities.find((o) => {
          if (o.claimed) return false;
          return state.players.find((p) => p.id === o.playerId)?.isAgent ?? false;
        });
        if (!opp) break;
        await transport.send({ type: 'loot_request', gameId, playerId: opp.playerId, lootId: opp.id, state });
        const res = await transport.receive();
        if (res.type === 'loot_response') engine.claimLoot(res.lootId, res.tokenIndices);
        break;
      }

      case 'upkeep': {
        const pending = state.players.find(
          (p) => p.isAgent && !p.isEliminated && !state.upkeepAllocations[p.id],
        );
        if (!pending) break;
        await transport.send({ type: 'upkeep_request', gameId, playerId: pending.id, state });
        const res = await transport.receive();
        if (res.type === 'upkeep_response') engine.submitUpkeepAllocation(res.playerId, res.allocations);
        break;
      }
    }
  }

  await transport.send({
    type: 'game_over',
    gameId,
    winnerId: engine.getWinner()?.id,
    state: engine.getState(),
  });

  await transport.close();
}
