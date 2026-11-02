import * as THREE from 'three';
import { HEX_RADIUS } from './grid.js';

/**
 * Hexagon shapes for the board (pointy-top, like the grid: a corner points up and down the screen, flat sides left and
 * right). `scale` shrinks them inside the cell (1 = the full cell, flat-to-flat width 1).
 */

/** A flat hexagon lying on the ground (y = 0), centred on the origin. */
export function hexPlane(scale = 1) {
  return new THREE.CircleGeometry(HEX_RADIUS * scale, 6, Math.PI / 2).rotateX(-Math.PI / 2);
}

/** A hexagonal block `height` tall, standing on y = 0 (sides group 0, top group 1, bottom group 2). */
export function hexPrism(height, scale = 1) {
  const r = HEX_RADIUS * scale;
  return new THREE.CylinderGeometry(r, r, height, 6).translate(0, height / 2, 0);
}

/** The outline of a flat hexagon (for LineSegments). */
export function hexOutline(scale = 1) {
  return new THREE.EdgesGeometry(hexPlane(scale));
}

/** The 6 corners [x, z] of a cell's hexagon (scaled), clockwise from the top corner as seen on screen. */
export function hexCorners(scale = 1) {
  const r = HEX_RADIUS * scale;
  return Array.from({ length: 6 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3; // -90° = up the screen (-z), then clockwise
    return [r * Math.cos(a) + 0, r * Math.sin(a) + 0];
  });
}
