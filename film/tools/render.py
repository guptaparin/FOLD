"""
Frame-by-frame renderer for the FOLD film.

  python3 film/tools/render.py OUT_DIR [START END [STEP]]   # frames [START, END)
Frames are simulated in order; skipped frames are stepped but not captured.
"""
import sys, time, os
from playwright.sync_api import sync_playwright

out = sys.argv[1]
start = int(sys.argv[2]) if len(sys.argv) > 2 else 0
end = int(sys.argv[3]) if len(sys.argv) > 3 else 960
stride = int(sys.argv[4]) if len(sys.argv) > 4 else 1
only = set(int(x) for x in os.environ.get('ONLY', '').split(',') if x)
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-vsync'])
    pg = b.new_page(viewport={'width': 1920, 'height': 1080})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    pg.goto('http://127.0.0.1:5199/index.html?' + os.environ.get('Q', 'scale=0.75'))
    pg.wait_for_function('window.film && window.film.ready', timeout=180000)
    t0 = time.time(); shots = 0
    for n in range(0, end):
        capture = n >= start and ((n - start) % stride == 0) and (not only or n in only)
        if not capture:
            # Advance the simulation without drawing.
            pg.evaluate(f'window.film.sim({n})')
            continue
        pg.evaluate(f'window.film.frame({n})')
        if capture:
            pg.screenshot(path=f'{out}/f{n:04d}.png', type='png', timeout=180000)
            shots += 1
            if shots % 20 == 0:
                print(f'frame {n}  {(time.time()-t0)/shots:.2f} s/frame', flush=True)
    print(f'done {shots} frames in {time.time()-t0:.0f}s; errors: {errs[:5]}')
    b.close()
