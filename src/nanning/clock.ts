/** Game-clock helpers. `t` is time-of-day in [0,1), 0 = midnight. */

export function hourFromDay(t: number): number {
  const wrapped = ((t % 1) + 1) % 1;
  return wrapped * 24;
}

/**
 * Night-market stalls are out from 18:00 until 05:00.
 * 18:00 is included; 05:00 they have packed up.
 */
export function nightMarketOpen(hour: number): boolean {
  return hour >= 18 || hour < 5;
}
