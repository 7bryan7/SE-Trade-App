import { emptyAccount, parseAccount } from './engine.ts';
import type { Account } from './engine.ts';
type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
// The stable Google subject, rather than an email address, owns each ledger.
export function createAccountStore(subject: string, storage: BrowserStorage) {
  if (!subject || subject.length > 255) throw new Error('A signed-in user is required.');
  const key = `tradesense.paper.v2.google.${encodeURIComponent(subject)}`;
  return {
    key,
    read(): Account { const raw = storage.getItem(key); return raw === null ? emptyAccount() : parseAccount(raw); },
    write(account: Account) { storage.setItem(key, JSON.stringify(account)); },
    clear() { storage.removeItem(key); },
  };
}
