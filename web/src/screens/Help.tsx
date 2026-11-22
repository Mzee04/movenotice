import { Section } from "../ui";

export function HowItWorks() {
  return <div className="stack">
    <Section title="How a move becomes effective">
      <ol className="help-steps">
        <li><strong>Post.</strong> The account owner signs a target, delay, nonce and expiry with ML-DSA-87. Anyone can relay the signed notice.</li>
        <li><strong>Review.</strong> Watchers can see the pending notice. The owner can sign a cancellation before the delay ends.</li>
        <li><strong>Resolve.</strong> The board returns the new address after the delay. GuardedPay then refuses payments to the old address and shows the suggested recipient.</li>
      </ol>
    </Section>
    <Section title="Two checks protect each action">
      <p>QoreChain requires an EVM authorisation window opened with a hybrid signature. The demo window limits transactions to MoveNotice and GuardedPay.</p>
      <p>MoveNotice also checks a fresh ML-DSA-87 signature against the account’s proven key in the chain registry. A stolen classical key alone cannot authorize a post or cancellation for an account that already registered its proven key.</p>
      <p>QoreX connects for reads. The local CLI produces the post-quantum signature and keeps the secret key off the page.</p>
    </Section>
    <Section title="What to verify yourself">
      <p>Treat the board as a first check. Verify the target with the recipient through a trusted channel. Typos can still reach the board, and the delay helps when someone is watching for changes.</p>
      <p>Accounts without a registered key can be taken over at first registration. Payment tools must choose to consult the board. This demo uses testnet precompiles and a ten-minute delay. Allow 48–72 hours for real use so watchers have time to respond.</p>
    </Section>
  </div>;
}
