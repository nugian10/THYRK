// eth.js — zero-dependency Ethereum helpers for the THYRK claim backend.
// No npm packages: Vercel snapshot deploys upload plain files, so this
// module implements everything the backend needs with Node built-ins
// (crypto for secp256k1 ECDSA, BigInt for curve math) plus a compact
// pure-JS keccak256 and RLP encoder.
// Verified against ethers v6 in claim-backend/tests/test-crypto.js.

'use strict';
const crypto = require('crypto');

// ---------------------------------------------------------------- keccak256
// Keccak-f1600, rate 1088 bits (136 bytes), 24 rounds, 256-bit output.
// This is the pre-NIST Keccak used by Ethereum (NOT NIST SHA3-256).
// State is a flat array of 25 lanes; lane index = x + 5*y.

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
const ROTC = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const MASK64 = (1n << 64n) - 1n;
function rotl64(x, n) {
  n = BigInt(n) % 64n;
  if (n === 0n) return x & MASK64;
  return ((x << n) | (x >> (64n - n))) & MASK64;
}
function keccakF1600(a) {
  for (let round = 0; round < 24; round++) {
    // Theta
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) a[x + 5 * y] ^= d;
    }
    // Rho + Pi (chained lane rotation)
    let t = a[1];
    for (let i = 0; i < 24; i++) {
      const j = PILN[i];
      const tmp = a[j];
      a[j] = rotl64(t, ROTC[i]);
      t = tmp;
    }
    // Chi
    for (let y = 0; y < 5; y++) {
      const row = [a[5 * y], a[5 * y + 1], a[5 * y + 2], a[5 * y + 3], a[5 * y + 4]];
      for (let x = 0; x < 5; x++) a[5 * y + x] = row[x] ^ (~row[(x + 1) % 5] & row[(x + 2) % 5]);
    }
    // Iota
    a[0] ^= RC[round];
  }
}
function keccak256(input) {
  const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const rate = 136; // bytes
  const a = new Array(25).fill(0n);
  let offset = 0;
  while (offset + rate <= data.length) {
    for (let i = 0; i < rate / 8; i++) a[i] ^= data.readBigUInt64LE(offset + i * 8);
    keccakF1600(a);
    offset += rate;
  }
  // Final block with keccak padding (0x01 ... 0x80)
  const rem = data.length - offset;
  const block = Buffer.alloc(rate);
  data.copy(block, 0, offset);
  block[rem] = 0x01;
  block[rate - 1] |= 0x80;
  for (let i = 0; i < rate / 8; i++) a[i] ^= block.readBigUInt64LE(i * 8);
  keccakF1600(a);
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(a[i], i * 8);
  return out;
}

// ---------------------------------------------------------------- hex utils
function hexToBytes(hex) {
  if (typeof hex !== 'string') throw new Error('hexToBytes: expected string');
  hex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (hex.length % 2) hex = '0' + hex;
  return Buffer.from(hex, 'hex');
}
function bytesToHex(b) {
  return '0x' + Buffer.from(b).toString('hex');
}
function isAddress(addr) {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
}
function toChecksumAddress(addr) {
  const a = addr.toLowerCase().replace(/^0x/, '');
  const hash = keccak256(Buffer.from(a, 'ascii')).toString('hex');
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? a[i].toUpperCase() : a[i];
  return out;
}

// ---------------------------------------------------------------- RLP
function rlpEncode(input) {
  if (Array.isArray(input)) {
    const payload = Buffer.concat(input.map(rlpEncode));
    return Buffer.concat([rlpLengthPrefix(payload.length, 0xc0), payload]);
  }
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length === 1 && buf[0] < 0x80) return buf;
  return Buffer.concat([rlpLengthPrefix(buf.length, 0x80), buf]);
}
function rlpLengthPrefix(len, offset) {
  if (len < 56) return Buffer.from([offset + len]);
  const lenBytes = bigIntToBytes(BigInt(len));
  return Buffer.concat([Buffer.from([offset + 55 + lenBytes.length]), lenBytes]);
}
function bigIntToBytes(n) {
  if (n === 0n) return Buffer.alloc(0);
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return Buffer.from(hex, 'hex');
}
function intToBytes(n) {
  const v = BigInt(n);
  if (v === 0n) return Buffer.alloc(0);
  return bigIntToBytes(v);
}

// ---------------------------------------------------------------- secp256k1
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

function pointAdd(p1, p2) {
  if (!p1) return p2;
  if (!p2) return p1;
  const [x1, y1] = p1, [x2, y2] = p2;
  let m;
  if (x1 === x2 && y1 === y2) {
    // double
    m = ((3n * x1 * x1) * modInv(2n * y1, P)) % P;
  } else {
    if (x1 === x2) return null; // opposite points
    m = ((y2 - y1) * modInv((x2 - x1 + P) % P, P)) % P;
  }
  const x3 = (m * m - x1 - x2) % P;
  const y3 = (m * (x1 - x3) - y1) % P;
  return [(x3 + P) % P, (y3 + P) % P];
}
function modInv(a, mod) {
  let [oldR, r] = [((a % mod) + mod) % mod, mod];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return ((oldS % mod) + mod) % mod;
}
function scalarMul(k, point) {
  let result = null;
  let addend = point;
  while (k > 0n) {
    if (k & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    k >>= 1n;
  }
  return result;
}
function privToPub(privBytes) {
  const d = BigInt('0x' + Buffer.from(privBytes).toString('hex'));
  if (d <= 0n || d >= N) throw new Error('invalid private key');
  const [x, y] = scalarMul(d, [Gx, Gy]);
  return Buffer.concat([bigIntToBytesPad(x, 32), bigIntToBytesPad(y, 32)]);
}
function bigIntToBytesPad(n, len) {
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const b = Buffer.from(hex, 'hex');
  if (b.length > len) throw new Error('bigint too large');
  return Buffer.concat([Buffer.alloc(len - b.length), b]);
}
function pubToAddress(pubBytes) {
  return toChecksumAddress(bytesToHex(keccak256(pubBytes)).slice(-40));
}
function privToAddress(privBytes) {
  return pubToAddress(privToPub(privBytes));
}

// ECDSA sign of a 32-byte hash (pure JS: Node's crypto.sign hashes the
// input with SHA-256 first, which is wrong for Ethereum digests).
// Returns { r, s, v } with v in {27,28} (recovery id resolved by trial
// ecrecover against the signer's address).
function ecSign(hashBytes, privBytes) {
  const d = BigInt('0x' + Buffer.from(privBytes).toString('hex'));
  if (d <= 0n || d >= N) throw new Error('invalid private key');
  const z = BigInt('0x' + Buffer.from(hashBytes).toString('hex'));
  const addr = privToAddress(privBytes);
  for (let attempt = 0; attempt < 10; attempt++) {
    const k = (BigInt('0x' + crypto.randomBytes(32).toString('hex')) % (N - 1n)) + 1n;
    const R = scalarMul(k, [Gx, Gy]);
    const r = R[0] % N;
    if (r === 0n) continue;
    let s = (modInv(k, N) * ((z + r * d) % N)) % N;
    if (s === 0n) continue;
    // Enforce low-s (EIP-2) for malleability safety.
    if (s > N / 2n) s = N - s;
    const rBytes = bigIntToBytesPad(r, 32);
    const sBytes = bigIntToBytesPad(s, 32);
    // Resolve recovery id by trial against the known address.
    for (const recid of [0, 1, 2, 3]) {
      const recovered = ecRecover(hashBytes, recid, rBytes, sBytes);
      if (recovered && recovered.toLowerCase() === addr.toLowerCase()) {
        return { r: rBytes, s: sBytes, v: 27 + recid };
      }
    }
  }
  throw new Error('ecSign: could not resolve recovery id');
}

// Recover the signer address from a 32-byte hash + (v, r, s).
function ecRecover(hashBytes, recid, rBytes, sBytes) {
  const r = BigInt('0x' + Buffer.from(rBytes).toString('hex'));
  const s = BigInt('0x' + Buffer.from(sBytes).toString('hex'));
  if (r <= 0n || r >= N || s <= 0n || s >= N) return null;
  const z = BigInt('0x' + Buffer.from(hashBytes).toString('hex'));
  // x = r + recid/2 * n ; y from curve equation with recid parity.
  const x = r + BigInt(Math.floor(recid / 2)) * N;
  if (x >= P) return null;
  const alpha = (x * x * x + 7n) % P;
  const y = modPow(alpha, (P + 1n) / 4n, P);
  if ((y * y) % P !== alpha) return null;
  const yIsOdd = y % 2n === 1n;
  const yFinal = (yIsOdd === (recid % 2 === 1)) ? y : P - y;
  const R = [x, yFinal];
  const rInv = modInv(r, N);
  const u1 = ((-z * rInv) % N + N) % N;
  const u2 = ((s * rInv) % N + N) % N;
  const Q = pointAdd(scalarMul(u1, [Gx, Gy]), scalarMul(u2, R));
  if (!Q) return null;
  const pub = Buffer.concat([bigIntToBytesPad(Q[0], 32), bigIntToBytesPad(Q[1], 32)]);
  return pubToAddress(pub);
}
function modPow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

// ---------------------------------------------------------------- EIP-191
function eip191Hash(message) {
  const msg = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8');
  const prefix = Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`, 'utf8');
  return keccak256(Buffer.concat([prefix, msg]));
}
// Verify a personal_sign signature (65-byte r||s||v) for a message.
function verifyPersonalSig(message, sigHex, expectedAddress) {
  const sig = hexToBytes(sigHex);
  if (sig.length !== 65) return false;
  const v = sig[64];
  if (v !== 27 && v !== 28) return false;
  const hash = eip191Hash(message);
  const recovered = ecRecover(hash, v - 27, sig.subarray(0, 32), sig.subarray(32, 64));
  return !!recovered && recovered.toLowerCase() === expectedAddress.toLowerCase();
}

// ---------------------------------------------------------------- legacy tx (EIP-155, type 0)
// tx: { nonce, gasPrice, gasLimit, to, value, data, chainId }
function signLegacyTx(tx, privBytes) {
  const fields = [
    intToBytes(tx.nonce), intToBytes(tx.gasPrice), intToBytes(tx.gasLimit),
    hexToBytes(tx.to), intToBytes(tx.value), hexToBytes(tx.data || '0x'),
    intToBytes(tx.chainId), Buffer.alloc(0), Buffer.alloc(0),
  ];
  const hash = keccak256(rlpEncode(fields));
  const { r, s, v } = ecSign(hash, privBytes);
  const chainV = BigInt(tx.chainId) * 2n + 35n + BigInt(v - 27);
  const signed = [
    intToBytes(tx.nonce), intToBytes(tx.gasPrice), intToBytes(tx.gasLimit),
    hexToBytes(tx.to), intToBytes(tx.value), hexToBytes(tx.data || '0x'),
    intToBytes(chainV), r, s,
  ];
  return bytesToHex(rlpEncode(signed));
}

// ABI-encode claimRepost(address): selector 0x... + 32-byte address.
function claimRepostCalldata(to) {
  const sel = keccak256(Buffer.from('claimRepost(address)', 'ascii')).subarray(0, 4);
  const addr = hexToBytes(to);
  return bytesToHex(Buffer.concat([sel, Buffer.alloc(12), addr]));
}

module.exports = {
  keccak256, hexToBytes, bytesToHex, isAddress, toChecksumAddress,
  rlpEncode, privToPub, pubToAddress, privToAddress,
  ecSign, ecRecover, eip191Hash, verifyPersonalSig,
  signLegacyTx, claimRepostCalldata,
};
