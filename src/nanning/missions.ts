/**
 * Mission marker + the pure log.
 *
 * The chain itself, the distinct-shop accounting, and the payout live in
 * `missionLogic.ts` so they can be unit-tested without Three.js. This file
 * only owns the gold ring in the world.
 */

import * as THREE from 'three';
import {
  MissionLog,
  anchorStreetMissions,
  tagForShop,
  type Mission,
  type MissionEvent,
  type ObjectiveKind,
} from './missionLogic';
import type { NanningCity } from './layout';

export type { ObjectiveKind, Mission, MissionEvent };
export { tagForShop };

export class Missions {
  private readonly log: MissionLog;
  readonly marker: THREE.Group;

  constructor(scene: THREE.Scene, city?: NanningCity) {
    this.log = new MissionLog();
    if (city) {
      anchorStreetMissions(
        this.log,
        city.shops.map((s) => ({ x: s.x, z: s.z, kind: s.def.kind, nightOnly: s.nightOnly })),
      );
    }

    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 2.1, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffd24a,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    this.marker.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 7, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd24a,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    beam.position.y = 3.5;
    this.marker.add(beam);
    this.marker.visible = false;
    scene.add(this.marker);
    this.syncMarker();
  }

  get active(): Mission | null {
    return this.log.active;
  }

  get completed(): Set<string> {
    return this.log.completed;
  }

  feed(e: MissionEvent): { title: string; reward: number; line: string } | null {
    const out = this.log.feed(e);
    this.syncMarker();
    return out;
  }

  progress(): string {
    return this.log.progress();
  }

  title(): string {
    return this.log.title();
  }

  brief(): string {
    return this.log.brief();
  }

  giver(): string {
    return this.log.giver();
  }

  objectiveLines(): { label: string; got: number; need: number }[] {
    return this.log.objectiveLines();
  }

  distanceTo(px: number, pz: number): number {
    return this.log.distanceTo(px, pz);
  }

  angleTo(px: number, pz: number): number {
    return this.log.angleTo(px, pz);
  }

  render(t: number): void {
    if (!this.marker.visible) return;
    this.marker.children[0].rotation.z = t * 0.8;
    const s = 1 + Math.sin(t * 2.4) * 0.09;
    this.marker.children[0].scale.set(s, s, 1);
  }

  consumeFinished(): Mission | null {
    return this.log.consumeFinished();
  }

  private syncMarker(): void {
    const wp = this.log.waypoint();
    if (!wp || !this.log.active) {
      this.marker.visible = false;
      return;
    }
    this.marker.position.set(wp.x, 0, wp.z);
    this.marker.visible = true;
  }
}
