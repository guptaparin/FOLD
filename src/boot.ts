/** Heavy half of the app: the IWSDK world and the game. Loaded after the landing page paints. */
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { FoldGame } from './game/game.js';

export async function boot(): Promise<World> {
  const world = await World.create(
    document.getElementById('scene-container') as HTMLDivElement,
    projectOptions,
  );
  world.registerSystem(FoldGame);
  return world;
}
