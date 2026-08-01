# crypto-lab-simon-period

## What It Is

**Simon's algorithm** (Daniel Simon, FOCS 1994 / SICOMP 1997) finds the hidden period of a black-box function using exponentially fewer queries than any classical algorithm can. Given `f` with the promise that `f(x) = f(y)` exactly when `y = x ⊕ s`, it recovers the `n`-bit secret `s` in **O(n)** quantum queries where the best classical attack needs **Θ(2^(n/2))**. It was the first proven exponential quantum separation for a decision-style problem, and the direct inspiration for Shor's algorithm, presented at the same conference (Simon at FOCS 1994 pp. 116–123, Shor immediately after at pp. 124–134).

It is also, since 2010, a working attack on symmetric cryptography. **Kuwakado and Morii (ISITA 2012)** observed that the Even-Mansour cipher `E(x) = P(x ⊕ k₁) ⊕ k₂` — provably secure to 2^(n/2) classical queries — makes `f(x) = E(x) ⊕ P(x)` periodic with period `k₁`, so the whitening key *is* a hidden period. **Kaplan, Leurent, Leverrier and Naya-Plasencia (CRYPTO 2016)** turned the same observation into forgeries against CBC-MAC, PMAC, GMAC, OCB and GCM. This is the quantum threat to symmetric crypto that Grover does not describe, and the one that doubling the key length does nothing about.

This demo runs the algorithm as an **exact statevector simulation**: real amplitudes, a real `H⊗ⁿ`, a real unitary XOR oracle, and 2^(n+m) numbers in a typed array. It could have sampled from the algorithm's known output distribution in one line, and that would have been a lie — the constructions attacked here do not satisfy Simon's promise exactly, and only an amplitude-level simulation reproduces what actually happens to them. Two of the four targets are real constructions with real consequences: the recovered Even-Mansour key is used to predict a fresh ciphertext, and the recovered CBC-MAC period is used to forge a tag on a message that was never queried, both checked against the real construction.

**This is not production cryptography.** A 4-to-6-bit block cipher is broken by definition — the whole codebook is on screen. The point is that the quantum cost grows like `n` while the classical cost grows like `2^(n/2)`, and that gap is real at every size.

The security model on display is the **Q2 model**: the attacker may query the *keyed* primitive in superposition. That is a strong assumption — no deployed system offers it — and the demo says so in-page rather than burying it.

## Exhibits

1. **Run Simon's algorithm** — four targets (Even-Mansour, CBC-MAC, a textbook 2-to-1 function, and a random permutation with no period at all) at 4, 5 or 6 bits. Each press of *Measure* runs one complete round — one superposition query, one interference step, one measurement — and appends one linear equation about the secret. The rank meter fills, the candidate count halves, and when the rank hits `n−1` the period is forced.
2. **The consequence, executed** — recovering the period is not the end. For Even-Mansour the demo derives `k₂ = E(0) ⊕ P(k₁)` from a single classical query and predicts a block it never encrypted; for CBC-MAC it forges a tag on a message it never sent. Both are compared byte-for-byte against the real construction, with a ✓ or ✗ per row.
3. **Why half the answers vanish** — the interference grid. Every one of the 2ⁿ outcomes is drawn with the sign of its amplitude, before and after the final Hadamard, and the cancelled ones read `0`. Select any outcome and both contributing paths are computed independently and added in front of you: `+1 + −1 = 0` is why that outcome is impossible, not merely unlikely.
4. **The equations, and what they pin down** — the measurement log, each entry marked *NEW*, *REDUNDANT*, or *y = 0, NO INFO*; the live row-reduced GF(2) matrix with its pivots; and the shrinking list of periods still consistent with everything measured.
5. **Count the queries** — a measured race. The classical attacker runs a real birthday collision search against the same table the circuit queries; the quantum side runs complete Simon rounds. Forty trials per width, both counting oracle queries the same way. Nothing here is a plotted curve.
6. **Grover, Simon, Shor** — what each one needs, what it gives, what victim it has, and what you do about it, including the access assumption that makes Simon the hardest of the three to actually mount.
7. **What this actually breaks** — Even-Mansour and CBC-MAC (live above), plus 3-round Feistel and quantum slide attacks (described and cited, not implemented), and an honest note that the countermeasure is removing algebraic self-similarity, not lengthening keys.

## When to Use It

- **Explaining why "double the key length" is an incomplete answer.** Grover's quadratic speedup is the entire basis of that advice. Simon's exponential speedup ignores key length completely: it attacks structure, and a 512-bit Even-Mansour key falls just as fast as a 64-bit one.
- **Evaluating a mode or MAC for quantum resistance.** The question to ask is not "how long is the key" but "can an attacker build a periodic function out of this primitive?" Every construction in the Kaplan et al. paper failed exactly that test.
- **Teaching quantum interference.** Simon's is the smallest algorithm where destructive interference is the whole mechanism and can be shown as arithmetic rather than asserted as magic.
- **Understanding where Shor came from.** Shor's algorithm is Simon's, moved from XOR periodicity to modular periodicity, with the quantum Fourier transform in place of the Hadamard.
- **When NOT to use it:** do **not** use this as evidence that AES or HMAC are quantum-broken — they are not, and neither has the structure Simon needs. And do not treat the Q2 model as a description of any deployed system; it is a strong assumption that the literature adopts deliberately, and an attack that needs it is not an attack you can mount today.

## Live Demo

**[systemslibrarian.github.io/crypto-lab-simon-period](https://systemslibrarian.github.io/crypto-lab-simon-period/)**

It opens on Even-Mansour with a fresh key. Press *Run to a verdict* and watch seven or so queries turn into a full key recovery and a correctly predicted ciphertext block. From there: click any cell in the interference grid to see the two amplitudes that cancelled it, switch to CBC-MAC and forge a tag, switch to the control target and watch the algorithm correctly report that there is nothing to find, or run the query race and get numbers produced by 240 complete attacks rather than by a formula.

## What Can Go Wrong

Real failure modes — in the attack, and in the constructions that must resist it.

- **Reading Grover's bound as the whole quantum story.** "Symmetric crypto only loses half its bits" is true of exhaustive key search and false of structured constructions. Even-Mansour's classical 2^(n/2) proof is tight and correct; it simply does not survive superposition access, and no amount of key length repairs it.
- **Trusting the linear algebra without checking.** The system can name a candidate that is not a period — accidental collisions and unlucky draws both cause it. This demo verifies every candidate against `f` over the whole domain before reporting it, and shows a rejected candidate on screen rather than silently retrying. Simon's algorithm is Las Vegas; treating it as deterministic is how you publish a wrong key.
- **Assuming the textbook promise holds.** Even-Mansour's `f` is *not* exactly 2-to-1 — at n = 6 accidental collisions are near-certain, and the demo reports how many. The attack survives because every preimage class is still a union of `s`-cosets, so the cancellation is unaffected; what changes is that the surviving outcomes are no longer uniformly distributed, so you need a few more queries. Getting this wrong in either direction — assuming it breaks the attack, or assuming it does not matter — misstates the result.
- **Mistaking "no period found" for "the algorithm failed".** Rank `n` is a proof that no non-zero period exists. The control target on this page produces it every time, and the demo reports it as a positive result rather than a timeout.
- **Building a mode whose masks are XOR offsets.** That is the shape Simon eats. OCB's offsets, GCM's `Eₖ(0)` multiplier, CBC-MAC's chaining, Even-Mansour's whitening, a self-similar key schedule — each is a place where an attacker can construct a periodic function.

## Real-World Usage

- **Even-Mansour and its descendants.** The minimal block-cipher construction, and the pattern behind the Elephant AEAD family, Chaskey's Even-Mansour-like core, and every "public permutation plus whitening" design. Kuwakado and Morii's 2012 result is why quantum security claims for these are stated in the Q1 model.
- **CBC-MAC, PMAC, GMAC, OCB and GCM.** Kaplan et al. give Simon-based forgeries against all of them. GCM is the mode behind the majority of TLS 1.3 traffic, which is why this result gets cited in every quantum-readiness assessment even though it needs Q2 access.
- **3-round Feistel.** Luby-Rackoff proves a 3-round Feistel with random round functions is a secure pseudorandom permutation classically. Kuwakado and Morii's 2010 paper distinguishes it from random in O(n) quantum queries — one of the cleanest examples of a classical proof that does not transfer.
- **Slide attacks.** Bonnetain, Naya-Plasencia and Schrottenloher recast the classical 2^(n/2) slide attack as a period-finding problem, making it polynomial. Self-similar key schedules — historically a mild design smell — become a fatal one.
- **NIST's post-quantum posture.** The reason NIST's lightweight and PQC processes ask about superposition-query security at all, rather than only about Grover, traces to this line of work.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-simon-period
cd crypto-lab-simon-period
npm install
npm run dev
```

`npm test` runs the unit suite; `npm run build && npm run test:a11y` runs the production build through the accessibility gate.

## Related Demos

- [crypto-lab-shor](https://systemslibrarian.github.io/crypto-lab-shor/) — the algorithm Simon's inspired, with the same period-finding shape moved to modular arithmetic.
- [crypto-lab-grover](https://systemslibrarian.github.io/crypto-lab-grover/) — the *other* quantum threat, and the one "double the key length" actually answers.
- [crypto-lab-harvest-timeline](https://systemslibrarian.github.io/crypto-lab-harvest-timeline/) — what these results mean on a deployment calendar.
- [crypto-lab-mac-race](https://systemslibrarian.github.io/crypto-lab-mac-race/) — the MACs this attack forges, running classically.
- [crypto-lab-aes-modes](https://systemslibrarian.github.io/crypto-lab-aes-modes/) — the modes whose XOR-offset structure is what Simon's algorithm grips.

## Build & Verify

**78 unit tests** (Vitest, colocated in `src/`), including these known-answer tests:

| KAT | Source | File |
| --- | --- | --- |
| Simon's measurement distribution is exactly uniform over `s⊥` and exactly zero elsewhere — checked for every `n` from 2 to 6 and every one of the 2ⁿ−1 possible periods | Simon, *On the Power of Quantum Computation*, SICOMP 1997, §4 | `src/quantum/simon.test.ts` |
| The post-Hadamard amplitude equals `(−1)^(x₀·y)(1 + (−1)^(s·y)) / √(2^(n+1))`, term for term | standard derivation (Nielsen & Chuang, *Quantum Computation and Quantum Information*) | `src/quantum/simon.test.ts` |
| Deferred measurement: reading the output register does not change the input-register distribution | deferred-measurement principle | `src/quantum/simon.test.ts` |
| `f(x) = E(x) ⊕ P(x)` has period exactly `k₁`, over the whole domain, for every width and key | Kuwakado & Morii, ISITA 2012 | `src/crypto/targets.test.ts` |
| CBC-MAC's `f(b, m) = MAC(α_b ‖ m)` has the affine period `(1 ‖ Eₖ(α₀) ⊕ Eₖ(α₁))`, and is exactly 2-to-1 | Kaplan, Leurent, Leverrier & Naya-Plasencia, CRYPTO 2016 | `src/crypto/targets.test.ts` |
| Classical period finding costs `√(π/2 · 2^(n−1))` queries — the birthday bound, measured over 400 runs | birthday bound | `src/classical/race.test.ts` |

Beyond the KATs, the suite pins the claims the page makes on screen: that the oracle is unitary and Hadamard is its own inverse; that measurements are orthogonal to the period **even when `f` has accidental collisions on top of it** (the precise reason the attack survives real constructions, asserted to 13 decimal places); that Even-Mansour at n = 6 really does collide accidentally, so the honesty note describes something real; that a full key recovery and a MAC forgery both succeed against the genuine construction and both **fail** when handed a wrong period; that an injective function drives the rank to `n` and leaves zero candidates; that Simon's mean query count sits between `n−1` and `n+3` at every width while the classical mean grows; and that the printed equation `s₅ ⊕ s₃ ⊕ s₂ ⊕ s₀ = 0` selects precisely the bits its vector sets, for all 64 vectors.

**Accessibility is gated in CI.** `@axe-core/playwright` scans the production build for WCAG 2.1 A/AA violations in both themes and at a 380px viewport, after a spec that drives every exhibit into its post-interaction states — all four targets, all three widths, the broken / no-period / in-progress verdicts, the secret reveal, both the cancelled and surviving forms of the arithmetic panel, and the measured race. Zero violations, or the deploy does not run.

## Performance

Everything runs on the main thread with no backend. The statevector holds 2^(n+m) doubles — 4,096 at the largest setting — and one Simon round is `n` Hadamard sweeps, one oracle permutation and two marginals, all of it microseconds. The heaviest action on the page is the query race: 240 complete attacks over 120 freshly built targets — one target per trial, each from a SHA-256-seeded Fisher-Yates shuffle, attacked once classically and once quantumly, on the order of a second. The cost of the simulation doubles with every qubit added, which is the honest reason the demo stops at six.

---

*One of 170+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
