import type { ToolInvocation } from '@/types/ai';

export interface SearchActivity {
  label: string;
  subject: string;
  outcome: string;
}

interface SearchResult {
  found?: boolean;
  error?: string;
  total?: number;
  results?: unknown[];
  matches?: unknown[];
}

type ActivityVerbs = [active: string, done: string, stopped: string];

const SEARCH: ActivityVerbs = ['Searching', 'Searched', 'Search stopped:'];
const LOOKUP: ActivityVerbs = ['Looking up', 'Looked up', 'Lookup stopped:'];
const ROLL: ActivityVerbs = ['Rolling', 'Rolled', 'Roll stopped:'];

function describeTarget(
  name: ToolInvocation['name'],
  category: unknown
): { verbs: ActivityVerbs; source: string } | null {
  switch (name) {
    case 'search_animadex':
      return {
        verbs: SEARCH,
        source:
          typeof category === 'string' ? `Animadex ${category}` : 'Animadex'
      };
    case 'retrieve_animadex_tag_by_id':
      return { verbs: LOOKUP, source: 'Animadex character' };
    case 'search_character_data':
      return { verbs: SEARCH, source: 'Character Data' };
    case 'roll_character_look':
      return { verbs: ROLL, source: 'Character Data look' };
    case 'search_character_library':
      return { verbs: SEARCH, source: 'Character Library' };
    default:
      return null;
  }
}

function describeOutcome(result: SearchResult): string {
  if (result.error) return 'Failed';
  if (result.found === false) return 'No matches';
  const count =
    result.total ?? result.results?.length ?? result.matches?.length;
  if (count === undefined) return '';
  if (count === 0) return 'No matches';
  return `${count.toLocaleString()} ${count === 1 ? 'match' : 'matches'}`;
}

export function describeSearchActivity(
  invocation: ToolInvocation
): SearchActivity | null {
  const { name, args, state, result } = invocation;
  const target = describeTarget(name, args.category);
  if (!target) return null;
  const [active, done, stopped] = target.verbs;
  const verb = result ? done : state === 'rejected' ? stopped : active;
  const subject = args.query ?? args.character ?? args.id;
  return {
    label: `${verb} ${target.source}`,
    subject: typeof subject === 'string' ? subject.trim() : '',
    outcome: result ? describeOutcome(result as SearchResult) : ''
  };
}
