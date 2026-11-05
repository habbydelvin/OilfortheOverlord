import * as THREE from 'three';
import { includeCurvedBounds } from './curvature.js';

let epoch = 0;
/** Start a pose/frame. Each animated batch computes its bound once, shared by colour, fog and shadow passes. */
export function nextBoundsFrame() { epoch++; }

/**
 * models.js batches rigid animated parts as one-bone-per-part skinning with identity bind matrices.
 * A union of the parts' transformed spheres encloses the exact current pose, without skinning every vertex on CPU.
 * Ordinary imported skins keep three.js's original behaviour.
 */
export function installRigidBounds(root) {
  root.traverse((mesh) => {
    const data = mesh.userData.rigidPartBounds;
    if (!mesh.isSkinnedMesh || !data || mesh._rigidBounds) return;
    const spheres = data.map((s) => new THREE.Sphere(new THREE.Vector3(...s.slice(0, 3)), s[3]));
    const world = new THREE.Sphere();
    const part = new THREE.Sphere();
    let pose = -1;
    mesh._rigidBounds = true;
    mesh.frustumCulled = true;
    mesh.intersectsFrustum = (frustum) => {
      if (pose !== epoch) {
        world.makeEmpty();
        for (let i = 0; i < spheres.length; i++) {
          const matrix = mesh.skeleton.bones[i].matrixWorld;
          part.copy(spheres[i]).applyMatrix4(matrix);
          // A hop scales a rotated hierarchy non-uniformly. Bound shear too (max eigenvalue of AᵀA ≤ max row sum).
          const e = matrix.elements;
          const xx = e[0] ** 2 + e[1] ** 2 + e[2] ** 2;
          const yy = e[4] ** 2 + e[5] ** 2 + e[6] ** 2;
          const zz = e[8] ** 2 + e[9] ** 2 + e[10] ** 2;
          const xy = Math.abs(e[0] * e[4] + e[1] * e[5] + e[2] * e[6]);
          const xz = Math.abs(e[0] * e[8] + e[1] * e[9] + e[2] * e[10]);
          const yz = Math.abs(e[4] * e[8] + e[5] * e[9] + e[6] * e[10]);
          part.radius = spheres[i].radius * Math.sqrt(Math.max(xx + xy + xz, yy + xy + yz, zz + xz + yz));
          world.union(part);
        }
        pose = epoch;
      }
      // The camera bend may change between passes/views without advancing the pose.
      part.copy(world);
      includeCurvedBounds(part);
      return frustum.intersectsSphere(part);
    };
  });
}
