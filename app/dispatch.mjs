// Turns a checked triage into what Serv does next. No AI here: plain rules.

import { findPriceItem } from './pricelist.mjs';

// Below this, Serv asks instead of offering. A guess that sends the wrong pro costs a wasted visit.
export const MIN_CONFIDENCE = 0.6;

export function propose(triage, bench) {
  if (triage.urgency === 'life_safety') {
    return { kind: 'emergency' };
  }
  const item = triage.priceItemId ? findPriceItem(triage.priceItemId) : null;
  if (!item || triage.confidence < MIN_CONFIDENCE || triage.questions.length > 0) {
    return { kind: 'needs_person' };
  }
  // Serv picks the pro: the nearest one on the bench for this trade.
  const pro = bench.filter((p) => p.trade === item.trade).sort((a, b) => a.blocksAway - b.blocksAway)[0];
  if (!pro) return { kind: 'needs_person' };
  return {
    kind: 'offer',
    item: { id: item.id, label: item.label, priceUsd: item.priceUsd },
    pro: { id: pro.id, name: pro.name, nextOpening: pro.nextOpening, blocksAway: pro.blocksAway, licensed: pro.licensed },
  };
}

export const DECISIONS = ['approve', 'pick_myself', 'decline'];

/** Records the owner's answer. Approving adds the job to the building file. */
export function decide(request, decision, building, now = new Date()) {
  if (request.proposal.kind !== 'offer') throw new Error('Nothing to decide on this request.');
  if (request.decision) throw new Error('This request already has a decision.');
  request.decision = { choice: decision, at: now.toISOString() };
  if (decision === 'approve') {
    const { item, pro } = request.proposal;
    building.file.push({
      id: `job-${request.id}`,
      kind: 'job',
      text: `${now.toISOString().slice(0, 10)}: ${item.label} in ${request.unit}. Sent ${pro.name} at $${item.priceUsd}. Tenant said: "${request.message.slice(0, 140)}"`,
    });
  }
  return request;
}
