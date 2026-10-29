// Checks the API from the top window (what DevTools' default "top" context sees).
export default async function run({ page, frame }) {
  await page.waitForTimeout(4000);
  const top = await page.mainFrame().evaluate(() => ({ fold: typeof window.fold, autopilot: typeof window.fold?.autopilot }));
  const inner = await frame.evaluate(() => typeof window.fold);
  return JSON.stringify({ topIsAppFrame: frame === page.mainFrame(), top, inner });
}
