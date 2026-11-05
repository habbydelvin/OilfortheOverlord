/** Coalesce visual updates within one payout frame (or skip), without delaying resource bookkeeping. */
export class PayoutHud {
  pending = null;

  constructor(drawOil, drawStore) {
    this.drawOil = drawOil;
    this.drawStore = drawStore;
  }

  oilAmount(fallback) {
    return this.pending?.oil?.[0] ?? fallback;
  }

  showOil(amount, bump = false) {
    if (this.pending) this.pending.oil = [amount, bump || Boolean(this.pending.oil?.[1])];
    else this.drawOil(amount, bump);
  }

  showStore(amount, cap, bump = false) {
    if (this.pending) this.pending.store = [amount, cap, bump || Boolean(this.pending.store?.[2])];
    else this.drawStore(amount, cap, bump);
  }

  batch(work) {
    if (this.pending) return work();
    const pending = (this.pending = {});
    try {
      return work();
    } finally {
      this.pending = null;
      if (pending.oil) this.drawOil(...pending.oil);
      if (pending.store) this.drawStore(...pending.store);
    }
  }
}
