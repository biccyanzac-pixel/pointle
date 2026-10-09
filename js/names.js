// Nickname / town / group-name cleaning and a small profanity filter. Shared by the site and the worker
// (the worker's check is the one that counts).

export const MAX_NAME = 20;
export const MAX_TOWN = 40;

// Deliberately short: catches the common slurs and swearing, including simple l33t spellings.
// Stored as fragments so the list itself doesn't read as a wall of abuse.
const BAD = [
  'fuck', 'shit', 'cunt', 'bitch', 'bastard', 'wank', 'twat', 'dick', 'cock', 'pussy', 'whore', 'slut', 'fag',
  'nigg', 'nigga', 'chink', 'spic', 'kike', 'paki', 'retard', 'rape', 'nazi', 'hitler', 'porn', 'penis', 'vagina',
  'arse', 'asshole', 'bollock', 'tosser', 'prick', 'dildo', 'jizz', 'cum', 'tits', 'boob',
];
// fragments that are only bad as whole words (so "Scunthorpe", "Dickens", "Cumbria", "Arsenal" survive)
const WHOLE_WORD_ONLY = new Set(['cum', 'dick', 'cock', 'arse', 'tits', 'spic', 'paki', 'prick', 'fag', 'rape', 'cunt']);

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };

function squash(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[0134578@$!|]/g, (c) => LEET[c]);
}

export function isProfane(raw) {
  const s = squash(raw);
  const joined = s.replace(/[^a-z]/g, '');
  const words = s.split(/[^a-z]+/).filter(Boolean);
  return BAD.some((b) => (WHOLE_WORD_ONLY.has(b) ? words.includes(b) || words.includes(`${b}s`) : joined.includes(b)));
}

/** Trim, collapse whitespace, strip control characters. Returns null if empty or too long. */
export function cleanText(raw, max) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
  if (!s || [...s].length > max) return null;
  return s;
}

/** Validated nickname, or { error }. */
export function checkName(raw) {
  const s = cleanText(raw, MAX_NAME);
  if (!s) return { error: `Nickname must be 1-${MAX_NAME} characters.` };
  if (isProfane(s)) return { error: 'Please pick a different nickname.' };
  return { value: s };
}

/** Optional town: empty is fine. */
export function checkTown(raw) {
  if (raw == null || (typeof raw === 'string' && !raw.trim())) return { value: null };
  const s = cleanText(raw, MAX_TOWN);
  if (!s) return { error: `Town must be at most ${MAX_TOWN} characters.` };
  if (/\d+\.\d+/.test(s)) return { error: 'Just the town name, please (no coordinates).' };
  if (isProfane(s)) return { error: 'Please pick a different town name.' };
  return { value: s };
}
