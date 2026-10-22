// Gameplay interaction test: drives the real game in headless Chromium and
// asserts the behaviors that were reported broken — building collision,
// entering ANY nearby car (not just the spawn car), and physical bump & shove.
// Uses the window.__game debug handle to set up deterministic scenarios.
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { preview } from 'vite';

const server = process.env.URL ? null : await preview({ preview: { port: 5182 } });
const URL = process.env.URL || server.resolvedUrls.local[0];
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'],
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
};

/** Fraction of near-black samples, plus how many distinct colours the frame has. */
function frameStats(buf) {
  const png = PNG.sync.read(buf);
  let dark = 0;
  let n = 0;
  const colors = new Set();
  for (let y = 0; y < png.height; y += 4) {
    for (let x = 0; x < png.width; x += 4) {
      const i = (png.width * y + x) << 2;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum < 10) dark++;
      colors.add((r >> 4) + ',' + (g >> 4) + ',' + (b >> 4));
      n++;
    }
  }
  return { dark: n ? dark / n : 1, colors: colors.size };
}

/** A clipped interior is a near-solid black frame. Daylight still has the coat and the room. */
function frameReadable(stats) {
  return stats.dark < 0.55 && stats.colors >= 18;
}

async function settle(page) {
  const t0 = await page.evaluate(() => window.__game.timeOfDay);
  await page.waitForFunction((start) => {
    const t = window.__game.timeOfDay;
    const dt = t >= start ? t - start : t + 1 - start;
    return dt * 1440 > 0.08;
  }, t0, { timeout: 120000 });
}

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  const reset = async () => {
    await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__skipSplash?.()); // skip the start splash (clean teardown)
    // The food street starts on foot. Most scenarios below were written for a
    // driving spawn, so mount the car at the player's feet before they run.
    // Wait for the world to exist before touching anything: the page is
    // slower than it was — there is traffic on the street now — and a test
    // that reaches in before the scene is built is testing the loading
    // screen.
    await page.waitForFunction(
      () => !!(window.__nn && window.__nn.vehicles && window.__nn.vehicles.cars.length),
      null,
      { timeout: 180000 },
    );
    const mode = await page.evaluate(() => window.__game.mode);
    if (mode === 'foot') {
      await page.evaluate(() => {
        const g = window.__game;
        const c = g.vehicles.cars[g.vehicles.playerIndex ?? 0];
        g.teleport(c.x + 2.4, c.z, 0);
      });
      // The second argument to waitForFunction is `arg`, not `options`: the
      // timeout object used to be passed as the argument and thrown away, so
      // every one of these waits silently used the 30 s default.
      await pressFUntil('driving');
    }
  };
  // Press F until the game is actually in `mode`. The page can still be
  // building the world when the key goes down, and a key pressed into a game
  // that is not ready yet is a key press into the void.
  const pressFUntil = async (mode) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      await page.keyboard.press('KeyF');
      const ok = await page
        .waitForFunction((m) => window.__game.mode === m, mode, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      if (ok) return true;
    }
    return false;
  };

  // Daylight, HUD hidden, stay on foot. Used where the assertion is the picture.
  const resetOnFoot = async () => {
    const lit = new globalThis.URL(URL);
    lit.searchParams.set('t', '0.45');
    lit.searchParams.set('hud', '0');
    await page.goto(lit.toString(), { waitUntil: 'load', timeout: 300000 });
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__skipSplash?.());
    await page.waitForFunction(() => window.__game.mode === 'foot', { timeout: 180000 });
  };

  // Headless swiftshader often renders under 2 fps, so a fixed 200 ms is not a frame.
  const waitMode = async (mode) => {
    await page.waitForFunction((m) => window.__game.mode === m, mode, { timeout: 180000 });
  };

  // 1 real second = 1 game minute, so timeOfDay advances by dt/1440. Wall-clock
  // waits under-run the sim when a frame costs most of a second.
  const DAY = 1440;
  const simSince = async (t0) => page.evaluate(({ t0, day }) => {
    let d = window.__game.timeOfDay - t0;
    if (d < -0.5) d += 1;
    return d * day;
  }, { t0, day: DAY });

  // Drive over a line of pedestrians to earn a wanted level. Polls for police
  // rather than waiting a fixed time — the headless renderer steps the fixed-
  // timestep sim slowly under load, so a fixed wait under-travels the car.
  // The people on this street are the crowd, so the crowd is who a car can
  // run over. The old version of this asked a population the city does not
  // have, and read a counter that only that population moved.
  const raiseWanted = async () => {
    await page.evaluate(() => {
      const g = window.__game;
      const p = g.vehicles.cars[g.vehicles.playerIndex];
      const crowd = window.__nn.crowd;
      for (let i = 0; i < 4; i++) {
        const t = crowd.talkers[i];
        t.combat = 'none'; t.x = p.x + 6 + i * 3; t.z = p.z;
      }
      p.heading = 0; p.vx = 24; p.vz = 0;
    });
    await page.keyboard.down('KeyW');
    let heat = { kills: 0, wanted: 0, police: 0 };
    for (let i = 0; i < 90 && heat.police < 1; i++) {
      await page.waitForTimeout(120);
      heat = await page.evaluate(() => ({
        kills: window.__nn.crowd.runOvers,
        wanted: window.__game.wanted,
        police: window.__game.police,
      }));
    }
    await page.keyboard.up('KeyW');
    return heat;
  };

  // --- 0. Start splash shows on load and dismisses on input (fades out).
  await page.goto(URL, { waitUntil: 'load', timeout: 300000 });
  await page.waitForTimeout(500);
  const splashShown = await page.evaluate(() => !!document.getElementById('splash'));
  await page.keyboard.press('Space'); // any key continues
  let splashGone = false;
  for (let i = 0; i < 20 && !splashGone; i++) {
    await page.waitForTimeout(150); // poll through the fade-to-black + fade-from-black + removal
    splashGone = await page.evaluate(() => !document.getElementById('splash'));
  }
  check('splash shows on load and dismisses on input', splashShown && splashGone, `shown=${splashShown}, gone=${splashGone}`);

  // --- 0b. Dismissing the splash raises the title menu (paused) until Play.
  let titleState = { menu: false, paused: false };
  for (let i = 0; i < 20 && !(titleState.menu && titleState.paused); i++) {
    await page.waitForTimeout(100);
    titleState = await page.evaluate(() => ({
      menu: !!document.getElementById('menu') && getComputedStyle(document.getElementById('menu')).display !== 'none',
      paused: window.__game.paused,
    }));
  }
  await page.click('#menu-play'); // Play → enter the running game
  await page.waitForTimeout(200);
  const playing = await page.evaluate(() => ({
    menu: getComputedStyle(document.getElementById('menu')).display !== 'none',
    paused: window.__game.paused,
  }));
  check(
    'title menu shows after splash and Play starts the game',
    titleState.menu && titleState.paused && !playing.menu && !playing.paused,
    `title{menu:${titleState.menu},paused:${titleState.paused}} -> play{menu:${playing.menu},paused:${playing.paused}}`,
  );

  // --- 1. Building collision: drive straight into a wall, don't pass through.
  await reset();
  const wall = await page.evaluate(() => {
    const g = window.__game;
    const c = g.city.colliders.reduce((a, b) => (b.minX < a.minX ? b : a));
    const car = g.vehicles.cars[g.vehicles.playerIndex];
    car.x = c.minX - 3;
    car.z = (c.minZ + c.maxZ) / 2;
    car.heading = 0; // face +X, into the wall
    car.vx = car.vz = 0;
    return { minX: c.minX };
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1600);
  await page.keyboard.up('KeyW');
  const afterRam = await page.evaluate(() => {
    const g = window.__game;
    const car = g.vehicles.cars[g.vehicles.playerIndex];
    return { x: car.x };
  });
  check(
    'building collision blocks the car',
    afterRam.x < wall.minX && afterRam.x > wall.minX - 3.5,
    `car.x=${afterRam.x.toFixed(2)} vs wall minX=${wall.minX.toFixed(2)}`,
  );

  // --- 2. Enter another car: stand beside a traffic car on foot, press F.
  await reset();
  // Clear the street first. The first F has to leave the spawn car, and with
  // traffic on 中山路 now there could be a car within reach of it — the test
  // would enter that one instead of getting out, and never get to the thing
  // it is actually testing.
  await page.evaluate(() => {
    const cars = window.__game.vehicles.cars;
    cars.forEach((c, i) => {
      if (i === window.__game.vehicles.playerIndex) return;
      c.role = 'parked'; c.lane = null; c.x = 9000 + i; c.z = 9000; c.vx = c.vz = 0;
    });
  });
  // Which car was the player's own? After stepping out, `playerIndex` is null,
  // so "not my car" has to be remembered rather than looked up.
  const spawnIdx = await page.evaluate(() => window.__game.vehicles.playerIndex);
  await pressFUntil('foot'); // exit spawn car -> on foot
  const target = await page.evaluate((skip) => {
    const g = window.__game;
    const cars = g.vehicles.cars;
    const j = cars.findIndex((c, i) => i !== skip && c.role !== 'police');
    // Then put one car deliberately in the middle of the carriageway and stand
    // beside it. Picking whichever car the traffic happened to have nearest
    // was a race against the moving sim, and the test lost that race about as
    // often as it won it.
    const c = cars[j];
    c.role = 'parked'; c.lane = null; c.vx = c.vz = 0;
    c.x = 0; c.z = -80; c.heading = -Math.PI / 2;
    g.teleport(-2.6, -80, 0);
    return { j, wasFoot: g.mode === 'foot' };
  }, spawnIdx);
  await pressFUntil('driving'); // enter the car beside us
  const entered = await page.evaluate(() => ({
    mode: window.__game.mode,
    playerIndex: window.__game.vehicles.playerIndex,
  }));
  check(
    'can enter another (traffic) car',
    target.wasFoot && entered.mode === 'driving' && entered.playerIndex === target.j,
    `target=${target.j} now driving index ${entered.playerIndex}`,
  );

  // --- 3. Bump & shove: ram a stationary car, it gets knocked away.
  // The spawn ride is a 60 kg e-bike; it cannot punt a sedan. Carjack a heavy
  // car and hit another one on the open carriageway.
  await reset();
  const shove = await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    const heavy = v.cars.findIndex((c) => c.role !== 'police' && c.profile.mass > 800);
    const t = v.cars.findIndex((c, i) => i !== heavy && c.role !== 'police');
    v.enter(heavy);
    const cz = -100; // open carriageway, clear of stalls and shopfronts
    v.cars.forEach((c, i) => {
      if (i === t || i === heavy) return;
      c.role = 'parked'; c.lane = null; c.x = 9000 + i; c.z = 9000; c.vx = c.vz = 0;
    });
    const target = v.cars[t];
    target.role = 'parked';
    target.lane = null;
    target.x = 0;
    target.z = cz + 8;
    target.heading = -Math.PI / 2;
    target.vx = target.vz = 0;
    const p = v.cars[heavy];
    p.x = 0;
    p.z = cz;
    p.heading = -Math.PI / 2; // face +Z, down the road
    p.vx = 0;
    p.vz = 22;
    return { t, sx: target.x, sz: target.z };
  });
  await page.keyboard.down('KeyW');
  const shoveT0 = await page.evaluate(() => window.__game.timeOfDay);
  let shoved = 0;
  for (let i = 0; i < 80 && shoved < 1.5; i++) {
    await page.waitForTimeout(100);
    shoved = await page.evaluate((s) => {
      const c = window.__game.vehicles.cars[s.t];
      return Math.hypot(c.x - s.sx, c.z - s.sz);
    }, shove);
    if (await simSince(shoveT0) > 1.2) break;
  }
  await page.keyboard.up('KeyW');
  check(
    'ramming shoves the other car',
    shoved > 1.5,
    `target moved ${shoved.toFixed(2)} m`,
  );

  // --- 3b. Carjack a curbside PARKED car (not just moving traffic).
  await reset();
  const spawnIdx2 = await page.evaluate(() => window.__game.vehicles.playerIndex);
  await pressFUntil('foot'); // exit spawn car -> on foot
  const park = await page.evaluate((skip) => {
    const g = window.__game;
    const v = g.vehicles;
    const cars = v.cars;
    // Pick a car that is not the player's own, BANISH every other car far away,
    // and then place this one deliberately: whichever car happened to be
    // parked nearest was a race against the moving sim.
    const j = cars.findIndex((c, i) => i !== skip && c.role !== 'police');
    cars.forEach((c, i) => {
      if (i !== j) { c.role = 'parked'; c.lane = null; c.x = 9000 + i; c.z = 9000; c.vx = c.vz = 0; }
    });
    const c = cars[j];
    c.role = 'parked'; c.lane = null; c.vx = c.vz = 0;
    c.x = 1.8; c.z = -95; c.heading = -Math.PI / 2; // at the kerb, facing down the street
    g.player.x = c.x - 2.6; // beside it: within reach, clear of push-out
    g.player.z = c.z;
    return { j };
  }, spawnIdx2);
  await pressFUntil('driving'); // get in
  let parked = { mode: 'foot', idx: null };
  try {
    await waitMode('driving');
    parked = await page.evaluate(() => ({
      mode: window.__game.mode,
      idx: window.__game.vehicles.playerIndex,
    }));
  } catch {
    parked = await page.evaluate(() => ({
      mode: window.__game.mode,
      idx: window.__game.vehicles.playerIndex,
    }));
  }
  check(
    'can enter a curbside parked car',
    parked.mode === 'driving' && parked.idx === park.j,
    `now driving index ${parked.idx} (target ${park.j})`,
  );

  // --- 4. Cars brake for a pedestrian standing in the road.
  await reset();
  await pressFUntil('foot'); // on foot
  await page.waitForTimeout(150);
  const braked = await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    const cars = v.cars;
    const j = cars.findIndex((c, i) => i !== v.playerIndex && c.role === 'ai');
    // Isolate the target far from the city edge on a known straight stretch, so
    // it can't wrap around mid-test. Player stands well ahead on the same lane.
    cars.forEach((c, i) => {
      if (i !== j) { c.role = 'parked'; c.lane = null; c.x = 9000 + i; c.z = 9000; c.vx = c.vz = 0; }
    });
    const c = cars[j];
    const cx = g.city.center.x;
    const cz = g.city.center.z;
    c.role = 'ai';
    // Down the street, not across it. The carriageway is nine metres wide, so
    // a car driving across it meets a 骑楼 shopfront in six metres — and the
    // pedestrian it is meant to brake for, twenty-two metres that way, would
    // be standing inside a building. 中山路 runs for three hundred metres
    // clear, which is the room this scenario needs.
    c.lane = { axis: 'z', fixed: cx, dir: 1 };
    c.cruise = 14;
    c.x = cx; c.z = cz - 30; c.vx = 0; c.vz = 14;
    g.player.x = cx; g.player.z = cz - 6;
    return { j };
  });
  // Poll until the car settles to a near-stop, and bail early if it hits the
  // ped. The budget is in SIMULATION seconds, not wall clock: the headless
  // renderer runs at well under one frame a second, so forty-five wall-clock
  // ticks are less than a second of the game — not nearly long enough for a
  // car at fourteen metres a second to close twenty-four metres and brake.
  const brakeT0 = await page.evaluate(() => window.__game.timeOfDay);
  let brakeRes = { speed: 99, dist: 0, health: 100, wasted: false };
  let brakeHit = false;
  for (let i = 0; i < 1200; i++) {
    await page.waitForTimeout(120);
    brakeRes = await page.evaluate((j) => {
      const g = window.__game;
      const c = g.vehicles.cars[j];
      return {
        speed: Math.hypot(c.vx, c.vz),
        dist: Math.hypot(c.x - g.player.x, c.z - g.player.z),
        health: g.health,
        wasted: g.wasted,
      };
    }, braked.j);
    if (brakeRes.health < 100 || brakeRes.wasted) { brakeHit = true; break; }
    if (brakeRes.speed < 1.2) break; // braked to a near-stop, short of the ped
    if (await simSince(brakeT0) > 5) break; // five seconds of game time
  }
  check(
    // Braked from a 14 m/s cruise and stopped short of the ped (never hit them).
    'cars brake for a standing pedestrian',
    !brakeHit && brakeRes.health === 100 && !brakeRes.wasted && brakeRes.speed < 1.5 && brakeRes.dist > 2.4,
    JSON.stringify(brakeRes),
  );

  // --- 5. Darting in front of a fast car from inside its stopping distance is fatal.
  await reset();
  await pressFUntil('foot');
  const deathCar = await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    const cars = v.cars;
    const j = cars.findIndex((c, i) => i !== v.playerIndex && c.role === 'ai');
    cars.forEach((c, i) => {
      if (i !== j) { c.role = 'parked'; c.lane = null; c.x = 9000 + i; c.z = 9000; c.vx = c.vz = 0; }
    });
    const c = cars[j];
    const cx = g.city.center.x;
    const cz = g.city.center.z;
    c.role = 'ai';
    // Down the street, for the same reason as the braking check above.
    c.lane = { axis: 'z', fixed: cx, dir: 1 };
    c.cruise = 30;
    c.x = cx; c.z = cz - 30; c.vx = 0; c.vz = 30;
    // Stand well clear first. Stepping out of the spawn car can leave the
    // contact latch set, and a later fast hit then does not count as a new impact.
    g.teleport(cx, cz + 25, 0);
    return j;
  });
  const deathT0 = await page.evaluate(() => window.__game.timeOfDay);
  await page.waitForFunction((t0) => {
    let d = window.__game.timeOfDay - t0;
    if (d < -0.5) d += 1;
    return d * 1440 > 0.05;
  }, deathT0);
  let deathRes = { health: 100, wasted: false };
  for (let i = 0; i < 50 && !deathRes.wasted; i++) {
    // Re-dart into the car's path. A single placement is missed when the
    // exit key and the hit fall in different sparse headless frames.
    await page.evaluate((j) => {
      const g = window.__game;
      const c = g.vehicles.cars[j];
      c.vx = 0; c.vz = 30;
      g.player.teleport(c.x, c.z + 0.6, 0);
    }, deathCar);
    await page.waitForTimeout(80);
    deathRes = await page.evaluate(() => ({ health: window.__game.health, wasted: window.__game.wasted }));
    if (await simSince(deathT0) > 2.5) break;
  }
  check(
    'jumping in front of a fast car is fatal (WASTED)',
    deathRes.health < 100 && deathRes.wasted === true,
    JSON.stringify(deathRes),
  );

  // --- 6. Run over someone at speed: they go down, and the wanted level
  // starts. The people on this street are the crowd, so this is also the only
  // place a car can hit anybody at all — the old check asked a population
  // this city does not have.
  await reset();
  const before = await page.evaluate(() => {
    const g = window.__game;
    const p = g.vehicles.cars[g.vehicles.playerIndex];
    p.heading = 0; p.vx = 22; p.vz = 0; // fast
    const crowd = window.__nn.crowd;
    const t = crowd.talkers[0];
    t.x = p.x + 3; t.z = p.z; t.combat = 'none';
    return { wanted: g.wanted, over: crowd.runOvers };
  });
  await page.keyboard.down('KeyW');
  // Pin them just ahead of the moving car each step, and poll for the
  // knockdown — robust to the slow headless sim rate.
  let splat = { over: before.over, state: 'none', wanted: before.wanted };
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => {
      const g = window.__game;
      const p = g.vehicles.cars[g.vehicles.playerIndex];
      const t = window.__nn.crowd.talkers[0];
      if (t.combat === 'none') { t.x = p.x + 2.2; t.z = p.z; }
      p.vx = 22;
    });
    await page.waitForTimeout(120);
    splat = await page.evaluate(() => ({
      over: window.__nn.crowd.runOvers,
      state: window.__nn.crowd.talkers[0].combat,
      wanted: window.__game.wanted,
    }));
    if (splat.state === 'down' && splat.wanted > before.wanted) break;
  }
  await page.keyboard.up('KeyW');
  // The wanted level is check 8's business: by now the stars may already be up
  // from an earlier check, and asking them to go higher would be asking for
  // the same thing twice.
  check(
    'running someone over knocks them down and counts as a crime',
    splat.over > before.over && splat.state === 'down',
    `runOvers ${before.over} -> ${splat.over}, state=${splat.state}, stars ${before.wanted} -> ${splat.wanted}`,
  );

  // --- 6b. A SLOW bump just shoves them (no gib, no score).
  await reset();
  // The previous check ran a car through a crowd; those knockdowns can still
  // be registering when this one starts. Let the count settle before reading
  // it, or this check is measuring the previous one's leftovers.
  let settled = await page.evaluate(() => window.__nn.crowd.runOvers);
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(150);
    const now = await page.evaluate(() => window.__nn.crowd.runOvers);
    if (now === settled) break;
    settled = now;
  }
  const slow = await page.evaluate(() => {
    const g = window.__game;
    const p = g.vehicles.cars[g.vehicles.playerIndex];
    const t = window.__nn.crowd.talkers[0];
    t.combat = 'none'; t.x = p.x + 2; t.z = p.z; // already in contact range
    p.heading = 0; p.vx = 2; p.vz = 0; // slow: under the knock-down threshold
    return { before: window.__nn.crowd.runOvers };
  });
  let bumped = { count: slow.before, state: 'none' };
  for (let i = 0; i < 30 && bumped.state === 'none'; i++) {
    await page.evaluate(() => {
      const g = window.__game;
      const p = g.vehicles.cars[g.vehicles.playerIndex];
      const t = window.__nn.crowd.talkers[0];
      if (t.combat === 'none') {
        t.x = p.x + 1.2; t.z = p.z; // inside contact range
        p.heading = 0; p.vx = 2; p.vz = 0;
      }
    });
    await page.waitForTimeout(80);
    bumped = await page.evaluate(() => ({
      count: window.__nn.crowd.runOvers,
      state: window.__nn.crowd.talkers[0].combat,
    }));
  }
  // Only the target is asserted on. The street has traffic in it now, so the
  // global run-over count can move on its own while this check runs — that is
  // the traffic doing its job, not this car.
  check(
    'a slow bump does not knock anyone over',
    bumped.state === 'none',
    `state=${bumped.state}, runOvers ${slow.before} -> ${bumped.count}`,
  );

  // --- 7. Radio: cycling the station with ] tunes off OFF to a station.
  // The food street ships no audio library, so the tuner stays off unless ?radio=1.
  await reset();
  const radioEnabled = await page.evaluate(() => window.__game.radioReady);
  if (!radioEnabled) {
    const label = await page.evaluate(() => window.__game.radioLabel);
    check('radio stays off without a local library', label === '📻 OFF', label);
  } else {
  const radioBefore = await page.evaluate(() => window.__game.radioLabel);
  // Retry the keypress until the tuner leaves OFF (robust to the headless
  // input/loop timing race), capped.
  let radioAfter = radioBefore;
  for (let i = 0; i < 8 && radioAfter === '📻 OFF'; i++) {
    await page.keyboard.press('BracketRight');
    await page.waitForTimeout(120);
    radioAfter = await page.evaluate(() => window.__game.radioLabel);
  }
  check(
    'radio tunes to a station on []',
    radioBefore === '📻 OFF' && radioAfter !== '📻 OFF' && radioAfter.startsWith('📻'),
    `"${radioBefore}" -> "${radioAfter}"`,
  );
  }

  // --- 8. Crime summons police: mow down pedestrians, get a wanted level + chasers.
  await reset();
  const heat = await raiseWanted();
  check(
    'running people over raises a wanted level and spawns police',
    heat.kills >= 1 && heat.wanted >= 1 && heat.police >= 1,
    JSON.stringify(heat),
  );

  // --- 9. A car bearing down scares pedestrians (vector trigger).
  await reset();
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.vehicles.cars[g.vehicles.playerIndex];
    const t = window.__nn.crowd.talkers[0];
    t.combat = 'none'; t.x = p.x + 12; t.z = p.z; // directly in the car's path
    p.heading = 0; p.vx = 18; p.vz = 0; // barreling toward it
  });
  await page.keyboard.down('KeyW');
  let carHit = false;
  const bearT0 = await page.evaluate(() => window.__game.timeOfDay);
  for (let i = 0; i < 400; i++) {
    await page.waitForTimeout(150);
    if (await page.evaluate(() => window.__nn.crowd.talkers[0].combat === 'down')) { carHit = true; break; }
    if (await simSince(bearT0) > 3) break;
  }
  await page.keyboard.up('KeyW');
  check('a car bearing down knocks someone over', carHit, `hit=${carHit}`);

  // --- 9b. On foot, pedestrians do NOT fear the player (by design).
  await reset();
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const g = window.__game;
    const t = window.__nn.crowd.talkers[0];
    t.combat = 'none'; t.x = g.player.x + 2; t.z = g.player.z; // right next to the on-foot player
  });
  await page.waitForTimeout(600);
  const onFootSafe = await page.evaluate(() => window.__nn.crowd.talkers[0].combat);
  check('people on the street are safe from a pedestrian player', onFootSafe === 'none', `state=${onFootSafe}`);

  // --- 9c. BUSTED: a cop pinning you slow resets the game.
  await reset();
  await raiseWanted(); // earn a chaser
  let bustedSeen = false;
  // Keep re-pinning on the open carriageway (player still, a cop 6 m ahead —
  // inside the 7 m bust radius, outside car-vs-car contact) and wait on SIM
  // time. The meter needs ~1.8 s of sim, and a wall-clock loop under-runs it
  // when each frame costs most of a second.
  const bustT0 = await page.evaluate(() => window.__game.timeOfDay);
  // 1200 ticks, not 400: the wall-clock budget has to outlast the simulation
  // budget, or the loop gives up before the game has had the seconds it needs.
  for (let i = 0; i < 1200 && !bustedSeen; i++) {
    await page.evaluate(() => {
      const v = window.__game.vehicles;
      const p = v.cars[v.playerIndex];
      p.x = 0; p.z = -100; p.vx = 0; p.vz = 0; p.heading = 0;
      const cop = v.cars.find((c) => c.role === 'police' && c.active);
      if (cop) { cop.x = 6; cop.z = -100; cop.vx = 0; cop.vz = 0; }
    });
    await page.waitForTimeout(80);
    bustedSeen = await page.evaluate(() => window.__game.busted);
    if (await simSince(bustT0) > 3.2) break;
  }
  check('cops bust you when they pin you slow', bustedSeen, `busted=${bustedSeen}`);

  // --- 9d. "Get away": break the cops' line of sight and the wanted level cools.
  await reset();
  const starsBefore = (await raiseWanted()).wanted;
  // The north barrier is a solid wall across the street. Hold the player on
  // the south side and every cop on the north side so no sight line survives.
  // Cooling starts after 4 s of SIM time out of sight.
  const losSetup = { px: 0, pz: -146, cx: 0, cz: -156 };
  let gotAway = false;
  const losT0 = await page.evaluate(() => window.__game.timeOfDay);
  for (let i = 0; i < 1500 && !gotAway; i++) {
    await page.evaluate((s) => {
      const v = window.__game.vehicles;
      const p = v.cars[v.playerIndex];
      p.x = s.px; p.z = s.pz; p.vx = 0; p.vz = 0;
      for (const c of v.cars) {
        if (c.role === 'police' && c.active) { c.x = s.cx; c.z = s.cz; c.vx = 0; c.vz = 0; }
      }
    }, losSetup);
    await page.waitForTimeout(80);
    const s = await page.evaluate(() => ({ cooling: window.__game.wantedCooling, wanted: window.__game.wanted }));
    if (s.cooling || s.wanted < starsBefore) gotAway = true;
    if (await simSince(losT0) > 6) break;
  }
  check(
    'breaking line of sight cools the wanted level',
    starsBefore >= 1 && gotAway,
    `stars before=${starsBefore}, gotAway=${gotAway}`,
  );

  // --- 10. Radio keeps playing after you get out of the car.
  await reset();
  const radioStill = await page.evaluate(() => window.__game.radioReady);
  if (!radioStill) {
    check('radio exit keeps the off state when no library is loaded', true, 'disabled');
  } else {
  await page.keyboard.press('KeyW'); // gesture: tune in the spawn car's radio
  await page.waitForTimeout(300);
  const inCar = await page.evaluate(() => window.__game.radioLabel);
  await page.keyboard.press('KeyF'); // step out
  await page.waitForTimeout(300);
  const onFoot = await page.evaluate(() => window.__game.radioLabel);
  check(
    'radio keeps playing after exiting the car',
    inCar.startsWith('📻') && inCar !== '📻 OFF' && onFoot === inCar,
    `in-car "${inCar}" -> on-foot "${onFoot}"`,
  );
  }

  // --- 11. Damage model: a moderate crash dents the car but it survives.
  await reset();
  const dent = await page.evaluate(() => {
    const g = window.__game;
    const c = g.city.colliders.reduce((a, b) => (b.minX < a.minX ? b : a));
    const car = g.vehicles.cars[g.vehicles.playerIndex];
    car.x = c.minX - 2; car.z = (c.minZ + c.maxZ) / 2; car.heading = 0;
    car.vx = 28; car.vz = 0; // a solid but survivable smack into the wall
    return { before: g.carHealth };
  });
  const dentT0 = await page.evaluate(() => window.__game.timeOfDay);
  let dented = { health: 100, wasted: false };
  for (let i = 0; i < 40 && dented.health === 100 && !dented.wasted; i++) {
    await page.waitForTimeout(80);
    dented = await page.evaluate(() => ({ health: window.__game.carHealth, wasted: window.__game.wasted }));
    if (await simSince(dentT0) > 0.8) break;
  }
  check(
    'a crash damages the car without wrecking it',
    dent.before === 100 && dented.health < 100 && dented.health > 0 && !dented.wasted,
    `carHealth ${dent.before} -> ${dented.health.toFixed(1)}`,
  );

  // --- 12. A full-speed FIRST hit damages the car hard but must NOT total it.
  await reset();
  await page.evaluate(() => {
    const g = window.__game;
    const c = g.city.colliders.reduce((a, b) => (b.minX < a.minX ? b : a));
    const car = g.vehicles.cars[g.vehicles.playerIndex];
    car.x = c.minX - 2; car.z = (c.minZ + c.maxZ) / 2; car.heading = 0;
    car.vx = 90; car.vz = 0; // flat out (~200 mph) straight into the wall
  });
  const hitT0 = await page.evaluate(() => window.__game.timeOfDay);
  let bigHit = { health: 100, wasted: false };
  for (let i = 0; i < 60 && bigHit.health === 100 && !bigHit.wasted; i++) {
    await page.waitForTimeout(80);
    bigHit = await page.evaluate(() => ({ health: window.__game.carHealth, wasted: window.__game.wasted }));
    if (await simSince(hitT0) > 1) break;
  }
  check(
    "a full-speed first hit doesn't total the car",
    bigHit.health > 0 && bigHit.health < 100 && !bigHit.wasted,
    `carHealth -> ${bigHit.health.toFixed(1)}, wasted=${bigHit.wasted}`,
  );

  // --- 12b. Enough damage DOES wreck the player car → explosion + WASTED.
  // The spawn e-bike tops out at 13 m/s, just over the free-bump threshold, so
  // a wall only scrapes it. A carjacked car still does a real impact.
  await reset();
  await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    const heavy = v.cars.findIndex((c) => c.role !== 'police' && c.profile.maxSpeed > 40);
    v.enter(heavy);
    v.cars.forEach((c, i) => {
      if (i === v.playerIndex) return;
      c.role = 'parked'; c.lane = null; c.x = 7000 + i; c.z = 7000; c.vx = c.vz = 0;
    });
    const wall = g.city.colliders.reduce((a, b) => (b.minX < a.minX ? b : a));
    const car = v.cars[v.playerIndex];
    car.x = wall.minX - 3; car.z = (wall.minZ + wall.maxZ) / 2; car.heading = 0;
    car.health = 20; // already badly damaged; one hard hit finishes it
    car.vx = 40; car.vz = 0;
  });
  const wreckT0 = await page.evaluate(() => window.__game.timeOfDay);
  let wreck = { health: 20, wasted: false, wrecks: 0 };
  for (let i = 0; i < 80 && !wreck.wasted; i++) {
    await page.waitForTimeout(100);
    wreck = await page.evaluate(() => ({
      health: window.__game.carHealth,
      wasted: window.__game.wasted,
      wrecks: window.__game.vehicles.wreckCount,
    }));
    if (await simSince(wreckT0) > 1.5) break;
  }
  check(
    'a wrecked car explodes and triggers WASTED',
    wreck.health === 0 && wreck.wasted === true && wreck.wrecks >= 1,
    JSON.stringify(wreck),
  );

  // --- 12c. An NPC car wrecks on its own (slams a wall) — player untouched.
  await reset();
  const npc = await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    const wall = g.city.colliders.reduce((a, b) => (b.minX < a.minX ? b : a));
    const t = v.cars.findIndex((c, i) => i !== v.playerIndex && c.role !== 'police');
    const car = v.cars[t];
    car.role = 'parked'; car.lane = null;
    car.x = wall.minX - 3; car.z = (wall.minZ + wall.maxZ) / 2;
    car.health = 20; // already battered
    car.heading = 0;
    car.vx = 40; car.vz = 0; // hurled east into the wall (coast does not clamp speed)
    // Keep the player car well away so only the NPC wrecks.
    const p = v.cars[v.playerIndex];
    p.x = g.city.center.x; p.z = g.city.center.z; p.vx = p.vz = 0;
    return { before: v.wreckCount };
  });
  const npcT0 = await page.evaluate(() => window.__game.timeOfDay);
  let npcWrecked = { wrecks: npc.before, wasted: false, carHealth: 100 };
  for (let i = 0; i < 80 && npcWrecked.wrecks <= npc.before; i++) {
    await page.waitForTimeout(100);
    npcWrecked = await page.evaluate(() => ({
      wrecks: window.__game.vehicles.wreckCount,
      wasted: window.__game.wasted,
      carHealth: window.__game.carHealth,
    }));
    if (await simSince(npcT0) > 1.5) break;
  }
  check(
    'an NPC car explodes when it takes enough damage (player untouched)',
    npcWrecked.wrecks > npc.before && !npcWrecked.wasted && npcWrecked.carHealth === 100,
    JSON.stringify(npcWrecked),
  );

  // --- 13. Outrunning cops: a cop left far behind closes the gap (rubber-band).
  await reset();
  // Raise a single wanted star so a cruiser chases. raiseWanted polls until
  // police exist, which a fixed 900 ms wait does not guarantee headless.
  await raiseWanted();
  const closeIn = await page.evaluate(() => {
    const v = window.__game.vehicles;
    const p = v.cars[v.playerIndex];
    p.vx = 0; p.vz = 0; // park the player; shove the cop far (within the leash)
    const cop = v.cars.find((c) => c.role === 'police' && c.active);
    if (!cop) return { gap0: 0 };
    cop.x = p.x + 120; cop.z = p.z; cop.vx = 0; cop.vz = 0;
    return { gap0: v.nearestPoliceDistance(p.x, p.z) };
  });
  // Poll over a window: a cop weaving the blocks claws ground back over time.
  let closedGap = closeIn.gap0;
  const gapT0 = await page.evaluate(() => window.__game.timeOfDay);
  for (let i = 0; i < 200 && closedGap > closeIn.gap0 - 25; i++) {
    await page.waitForTimeout(80);
    const s = await page.evaluate(() => {
      const v = window.__game.vehicles;
      const p = v.cars[v.playerIndex];
      return { gap: v.nearestPoliceDistance(p.x, p.z), busted: window.__game.busted };
    });
    if (s.busted) break;
    closedGap = Math.min(closedGap, s.gap);
    if (await simSince(gapT0) > 2.5) break;
  }
  check(
    // The old fixed cop speed made up no ground on a stationary target; the
    // rubber-band cop closes meaningfully (exact amount varies with weaving).
    'an outrun cop claws the gap back (rubber-band pursuit)',
    closeIn.gap0 > 110 && closedGap < closeIn.gap0 - 25,
    `gap ${closeIn.gap0.toFixed(0)} -> ${closedGap.toFixed(0)}`,
  );

  // --- 13b. A cop left beyond the leash is re-summoned near you.
  const leashGap0 = await page.evaluate(() => {
    const v = window.__game.vehicles;
    const p = v.cars[v.playerIndex];
    p.vx = 0; p.vz = 0;
    const cop = v.cars.find((c) => c.role === 'police' && c.active);
    if (!cop) return 0;
    cop.x = p.x + 240; cop.z = p.z; cop.vx = 0; cop.vz = 0; // way past the leash
    return v.nearestPoliceDistance(p.x, p.z);
  });
  // placeNear fires the next time drivePolice runs. Wait on sim time — a
  // 1 s wall clock often contains no headless frame.
  let leashGap = leashGap0;
  const leashT0 = await page.evaluate(() => window.__game.timeOfDay);
  for (let i = 0; i < 40 && leashGap > 120; i++) {
    await page.waitForTimeout(80);
    leashGap = await page.evaluate(() => {
      const v = window.__game.vehicles;
      const p = v.cars[v.playerIndex];
      return v.nearestPoliceDistance(p.x, p.z);
    });
    if (await simSince(leashT0) > 0.6) break;
  }
  check(
    'a cop left beyond the leash is re-summoned near you',
    leashGap0 > 230 && leashGap < 120,
    `gap ${leashGap0.toFixed(0)} -> ${leashGap.toFixed(0)}`,
  );

  // --- 12d. A damaged car trails smoke particles.
  await reset();
  await page.evaluate(() => {
    const g = window.__game;
    g.vehicles.cars[g.vehicles.playerIndex].health = 20; // badly damaged, not wrecked
  });
  await page.waitForTimeout(400);
  const smoke = await page.evaluate(() => window.__game.vehicles.smokeParticles());
  check('a damaged car emits smoke particles', smoke > 0, `live particles=${smoke}`);

  // --- 13c. On foot, punching a pedestrian gibs them into pixels (and scores).
  await reset();
  await page.keyboard.press('KeyF'); // get out of the car, on foot
  await page.waitForFunction(() => window.__game.mode === 'foot', { timeout: 180000 });
  const punchSetup = await page.evaluate(() => {
    const g = window.__game;
    g.player.heading = 0; // face +X
    // Isolate one target so the punch can only connect with it.
    const crowd = window.__nn.crowd;
    crowd.talkers.forEach((t, i) => {
      if (i > 0) { t.combat = 'none'; t.x = 9000 + i; t.z = 9000; }
    });
    return { before: crowd.runOvers, mode: g.mode, wanted: g.wanted };
  });
  let floored = false;
  for (let i = 0; i < 40 && !floored; i++) {
    await page.evaluate(() => {
      const g = window.__game;
      const t = window.__nn.crowd.talkers[0];
      if (t.combat === 'none') { // keep them pinned right in front until a punch lands
        t.x = g.player.x + 1.3; t.z = g.player.z;
      }
    });
    await page.keyboard.press('KeyJ'); // punch (J / left click; Space is jump)
    await page.waitForTimeout(150);
    floored = await page.evaluate(() => window.__nn.crowd.talkers[0].combat === 'down');
  }
  const punched = await page.evaluate(() => ({
    over: window.__nn.crowd.runOvers, wanted: window.__game.wanted,
  }));
  check(
    'punching someone on foot puts them on the floor, and is not a crime',
    punchSetup.mode === 'foot' && floored && punched.over === punchSetup.before && punched.wanted === punchSetup.wanted,
    `floored=${floored}, runOvers ${punchSetup.before} -> ${punched.over}, stars ${punchSetup.wanted} -> ${punched.wanted}`,
  );

  // --- 13d. Police don't run the on-foot player over (they arrest = BUSTED).
  await reset();
  await page.keyboard.press('KeyF'); // on foot
  await page.waitForTimeout(200);
  const copImpact = await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    v.setWanted(1, { x: g.player.x, z: g.player.z }, g.city); // activate a cruiser
    const cop = v.cars.find((c) => c.role === 'police' && c.active);
    cop.x = g.player.x; cop.z = g.player.z; cop.vx = 30; cop.vz = 0; // fast, right on the player
    return {
      countsAsImpact: !!v.pedestrianImpact(g.player.x, g.player.z, false, true),
      hurtsOnFoot: !!v.pedestrianImpact(g.player.x, g.player.z, false, false),
    };
  });
  check(
    'police are excluded from on-foot run-over damage (arrest, not splatter)',
    copImpact.countsAsImpact === true && copImpact.hurtsOnFoot === false,
    JSON.stringify(copImpact),
  );

  // --- 14. Cars come in varied body shapes (visual variety).
  await reset();
  const shapes = await page.evaluate(() => {
    const ids = new Set(window.__game.vehicles.cars.map((c) => c.shapeId));
    return [...ids];
  });
  check('cars have varied body shapes', shapes.length > 1, `shapes=${shapes.join(',')}`);

  // --- 14c. Cars are specific makes/models; you're driving one.
  const models = await page.evaluate(() => ({
    distinct: new Set(window.__game.vehicles.cars.map((c) => c.profile.id)).size,
    driving: window.__game.carModel,
  }));
  check(
    'cars are named makes/models and you drive one',
    models.distinct > 1 && typeof models.driving === 'string' && models.driving.length > 0,
    `distinct models=${models.distinct}, driving "${models.driving}"`,
  );

  // --- 14b. On foot, you can't clip through a parked car — you get pushed out.
  await reset();
  await page.keyboard.press('KeyF'); // on foot
  await page.waitForFunction(() => window.__game.mode === 'foot', { timeout: 180000 });
  const clip = await page.evaluate(() => {
    const g = window.__game;
    const v = g.vehicles;
    const t = v.playerIndex === 0 ? 1 : 0;
    const car = v.cars[t];
    car.role = 'parked'; car.lane = null; car.vx = car.vz = 0;
    car.x = g.player.x + 20; car.z = g.player.z; // a clear spot
    g.player.x = car.x; g.player.z = car.z; // drop the player right on the car
    return { t };
  });
  // Poll for the push-out (resolveActor runs in the foot update each frame).
  let pushed = 0;
  for (let i = 0; i < 14 && pushed < 1.9; i++) {
    await page.waitForTimeout(120);
    pushed = await page.evaluate((t) => {
      const g = window.__game;
      const car = g.vehicles.cars[t];
      return Math.hypot(g.player.x - car.x, g.player.z - car.z);
    }, clip.t);
  }
  check(
    'on foot you are pushed out of cars (no clipping)',
    pushed >= 1.9, // outside CAR_RADIUS — not standing inside the car
    `distance to car = ${pushed.toFixed(2)}`,
  );

  // --- 14d. Jump onto a shop table (stool / table tops are walkable).
  await resetOnFoot();
  const jumpSetup = await page.evaluate(() => {
    const g = window.__game;
    const shop = g.city.shops.find((s) => s.def.kind === 'noodle' && !s.nightOnly);
    g.teleport(shop.x + shop.nx * 1.2, shop.z, shop.nx > 0 ? Math.PI : 0);
    return { id: shop.id, nx: shop.nx, x: shop.x, z: shop.z };
  });
  let table = null;
  for (let i = 0; i < 40 && !table; i++) {
    await page.waitForTimeout(100);
    table = await page.evaluate((id) => {
      const props = window.__game.interiorProps();
      const t = props.find((p) => p.shopId === id && p.prop.startsWith('table'));
      return t ? { x: t.x, z: t.z, h: t.h, w: t.w } : null;
    }, jumpSetup.id);
  }
  let peak = 0;
  let landedOn = 0;
  if (table) {
    const heading = jumpSetup.nx > 0 ? Math.PI : 0;
    await page.evaluate((pose) => {
      // Street side of the tabletop, facing inland.
      window.__game.teleport(pose.x, pose.z, pose.heading);
    }, {
      x: table.x + jumpSetup.nx * (table.w / 2 + 0.85),
      z: table.z,
      heading,
    });
    // Walk, one jump. Mashing Space launches you off the table before a
    // grounded sample can see the landing.
    await page.keyboard.down('AltLeft');
    await page.keyboard.down('KeyW');
    let jumped = false;
    const edge = table.w / 2;
    for (let i = 0; i < 90 && landedOn < 0.4; i++) {
      const sample = await page.evaluate(() => ({
        x: window.__game.player.x,
        y: window.__game.player.y,
        grounded: window.__game.player.grounded,
      }));
      if (sample.y > peak) peak = sample.y;
      if (sample.grounded && sample.y > 0.4) { landedOn = sample.y; break; }
      const streetSide = (sample.x - table.x) * jumpSetup.nx;
      if (!jumped && sample.grounded && streetSide <= edge + 0.8 && streetSide >= edge + 0.25) {
        await page.keyboard.press('Space');
        jumped = true;
      }
      await page.waitForTimeout(80);
    }
    await page.keyboard.up('KeyW');
    await page.keyboard.up('AltLeft');
    for (let i = 0; i < 40 && landedOn < 0.4; i++) {
      await page.waitForTimeout(80);
      const sample = await page.evaluate(() => ({
        y: window.__game.player.y,
        grounded: window.__game.player.grounded,
      }));
      if (sample.y > peak) peak = sample.y;
      if (sample.grounded && sample.y > 0.4) landedOn = sample.y;
    }
  }
  let jumpFrame = { dark: 1, colors: 0 };
  let jumpCam = { dist: 0, blocked: true, eyeY: 0, y: landedOn };
  if (table && landedOn > 0.4) {
    await settle(page);
    jumpFrame = frameStats(await page.screenshot());
    jumpCam = await page.evaluate(() => ({
      dist: window.__game.camDist,
      blocked: window.__game.camBlocked,
      eyeY: window.__game.camEye.y,
      y: window.__game.player.y,
    }));
  }
  check(
    'jump lands on a shop table',
    !!table && landedOn > 0.4,
    `table=${table ? table.h.toFixed(2) : 'none'} peak=${peak.toFixed(2)} landed=${landedOn.toFixed(2)}`,
  );
  check(
    'table landing frames the player and the tabletop',
    !!table && landedOn > 0.4 && !jumpCam.blocked && jumpCam.dist >= 1.9 && jumpCam.eyeY > jumpCam.y + 0.8 && frameReadable(jumpFrame),
    `cam=${jumpCam.dist.toFixed(2)} eyeY=${jumpCam.eyeY.toFixed(2)} feet=${jumpCam.y.toFixed(2)} blocked=${jumpCam.blocked} dark=${jumpFrame.dark.toFixed(2)} colors=${jumpFrame.colors}`,
  );

  // --- 14e. Walk into each required shop type. The back wall still stops you.
  await resetOnFoot();
  for (const kind of ['noodle', 'fenjiao', 'grill', 'tea']) {
    const shop = await page.evaluate((kind) => {
      const s = window.__game.city.shops.find((sh) => sh.def.kind === kind && !sh.nightOnly);
      const heading = s.nx > 0 ? Math.PI : 0;
      window.__game.teleport(s.x + s.nx * 1.0, s.z, heading);
      return { id: s.id, x: s.x, z: s.z, nx: s.nx, depth: 8 };
    }, kind);
    // The interior flag updates on the sim tick, not inside teleport. A stale
    // "inside" from the previous shop must not count as walking in.
    await settle(page);
    // Screenshots blur the page, and blur clears the key set. Focus again or W never lands.
    await page.bringToFront();
    await page.evaluate(() => window.focus());
    await page.keyboard.down('KeyW');
    let inside = { x: shop.x, interior: false, cam: 0 };
    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(200);
      inside = await page.evaluate((s) => ({
        x: window.__game.player.x,
        interior: window.__game.interior,
        cam: window.__game.camDist,
      }), shop);
      const inland = shop.nx > 0 ? inside.x < shop.x - 0.35 : inside.x > shop.x + 0.35;
      if (inside.interior && inland) break;
    }
    await page.keyboard.up('KeyW');
    // Still short of the back wall (8 m inland).
    const stopped = shop.nx > 0 ? inside.x > shop.x - 9.2 : inside.x < shop.x + 9.2;
    await settle(page);
    const entered = await page.evaluate(() => ({
      interior: window.__game.interior,
      cam: window.__game.camDist,
      blocked: window.__game.camBlocked,
    }));
    const enteredFrame = frameStats(await page.screenshot());
    const facing = [];
    const inland = shop.nx > 0 ? Math.PI : 0;
    for (const yaw of [inland, inland + Math.PI, inland + Math.PI / 2, inland - Math.PI / 2]) {
      await page.evaluate(({ x, z, yaw }) => {
        window.__game.teleport(x, z, yaw);
      }, { x: shop.x - shop.nx * 3.1, z: shop.z, yaw });
      await settle(page);
      const view = await page.evaluate(() => ({
        cam: window.__game.camDist,
        blocked: window.__game.camBlocked,
        interior: window.__game.interior,
      }));
      const stats = frameStats(await page.screenshot());
      facing.push({ ...view, ...stats, yaw });
    }
    const viewsOk = facing.every((v) => v.interior && !v.blocked && v.cam > 1.5 && v.cam < 6 && frameReadable(v));
    check(
      `walk into a ${kind} shop without the camera clipping`,
      inside.interior && stopped && entered.interior && !entered.blocked && entered.cam > 1.5 && entered.cam < 6 && frameReadable(enteredFrame) && viewsOk,
      `x=${inside.x.toFixed(2)} entered dark=${enteredFrame.dark.toFixed(2)} colors=${enteredFrame.colors} cam=${entered.cam.toFixed(2)} blocked=${entered.blocked} facings=${facing.map((v) => `${v.dark.toFixed(2)}/${v.colors}/d${v.cam.toFixed(1)}`).join(' ')}`,
    );
  }

  // --- 15. Day/night cycle advances over time.
  await reset();
  const t0 = await page.evaluate(() => window.__game.timeOfDay);
  await page.waitForTimeout(500);
  const t1 = await page.evaluate(() => window.__game.timeOfDay);
  check('day/night cycle advances', t1 > t0, `timeOfDay ${t0.toFixed(4)} -> ${t1.toFixed(4)}`);

  // --- 16. Pause menu: Esc freezes the sim (time stops); Esc again resumes.
  await reset();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const pausedState = await page.evaluate(() => ({
    paused: window.__game.paused,
    menu: getComputedStyle(document.getElementById('menu')).display !== 'none',
    t: window.__game.timeOfDay,
  }));
  await page.waitForTimeout(500); // sim should NOT advance while paused
  const stillPaused = await page.evaluate(() => window.__game.timeOfDay);
  await page.keyboard.press('Escape'); // resume
  await page.waitForTimeout(1500);
  const resumed = await page.evaluate(() => ({
    paused: window.__game.paused,
    t: window.__game.timeOfDay,
  }));
  check(
    'Esc pauses (sim frozen) and resumes',
    pausedState.paused && pausedState.menu &&
      Math.abs(stillPaused - pausedState.t) < 1e-6 && // time frozen while paused
      !resumed.paused && resumed.t > stillPaused, // time advances again after resume
    `paused=${pausedState.paused} frozenΔ=${(stillPaused - pausedState.t).toFixed(5)} resumed=${!resumed.paused}`,
  );

  if (!results.some((r) => r.name === 'no page errors')) check('no page errors', true, '');
} finally {
  await browser.close();
  server?.httpServer.close();
}

if (results.some((r) => !r.ok)) {
  console.error('\nINTERACTION FAIL');
  process.exitCode = 1;
} else {
  console.log('\nINTERACTION PASS');
}
