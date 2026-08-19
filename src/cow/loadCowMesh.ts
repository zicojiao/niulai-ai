import { BufferAttribute, BufferGeometry } from 'three';

/**
 * `public/niulai-3d/niulai.mesh` is a flat binary container: a 16 byte header,
 * then float32 positions, float32
 * normals and uint32 indices back to back. One fetch, no parsing — the typed
 * arrays are views straight onto the response buffer.
 */
const MAGIC = 0x3155494e; // 'NIU1', little endian

export const COW_MESH_URL = '/niulai-3d/niulai.mesh';

export async function loadCowMesh(
  url = COW_MESH_URL,
  signal?: AbortSignal,
): Promise<BufferGeometry> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Could not load the 牛来 sculpt (${response.status}).`);
  }
  return decodeCowMesh(await response.arrayBuffer());
}

export function decodeCowMesh(buffer: ArrayBuffer): BufferGeometry {
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== MAGIC) {
    throw new Error('The 牛来 sculpt file is not in the expected format.');
  }
  const vertexCount = header.getUint32(4, true);
  const triangleCount = header.getUint32(8, true);

  const expected = 16 + vertexCount * 24 + triangleCount * 12;
  if (buffer.byteLength < expected) {
    throw new Error('The 牛来 sculpt file is truncated.');
  }

  const positions = new Float32Array(buffer, 16, vertexCount * 3);
  const normals = new Float32Array(buffer, 16 + vertexCount * 12, vertexCount * 3);
  const indices = new Uint32Array(buffer, 16 + vertexCount * 24, triangleCount * 3);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
