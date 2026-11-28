import { tool } from 'ai';
import { z } from 'zod';
import {
  autocompleteCharacterTags,
  CHARACTER_DATA_NOTE,
  CHARACTER_FIELD,
  CHARACTER_RATINGS,
  getCharacterPreset,
  randomizeCharacterFields
} from './characterData';

export const characterDataTools = {
  search_character_data: tool({
    description: `Search the built-in Character Data (Danbooru tag statistics) for a character by name, alias, or series, and get the best match's usual look as tags per field (hair, eyes, top, bottom, legwear, accessories, ...). ${CHARACTER_DATA_NOTE}`,
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe('Character name or alias, e.g. "miku" or "reimu"')
    }),
    execute: async ({ query }) => {
      const matches = (
        await autocompleteCharacterTags(CHARACTER_FIELD, query, 10)
      )
        .filter((match) => match.kind === 'character')
        .slice(0, 5);
      if (matches.length === 0)
        return {
          found: false,
          note: CHARACTER_DATA_NOTE,
          message:
            'No character matches that query. Try another spelling, then Animadex.'
        };
      return {
        found: true,
        source: 'character_data',
        note: CHARACTER_DATA_NOTE,
        matches: matches.map((match) => ({
          name: match.tag,
          series: match.series,
          posts: match.count,
          matchedAlias: match.alias
        })),
        usualLook: await getCharacterPreset(matches[0].tag)
      };
    }
  }),

  roll_character_look: tool({
    description: `Roll a varied look for a character from the built-in Character Data: identity (subject, hair, eyes, body) stays the character's usual look while outfit, pose, expression, view, and background are drawn together from one real Danbooru picture. Call again for another variation. ${CHARACTER_DATA_NOTE}`,
    inputSchema: z.object({
      character: z
        .string()
        .min(1)
        .describe(
          'Exact character tag from search_character_data, e.g. hatsune_miku'
        ),
      rating: z
        .enum(CHARACTER_RATINGS)
        .default('sensitive')
        .describe('Highest Danbooru rating the roll may draw from'),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          'Fields to roll; default all. Available: subject, hair, eyes, body, outfit, top, bottom, legwear, accessories, expression, pose, view, background'
        ),
      mustInclude: z
        .array(z.string())
        .optional()
        .describe('Danbooru tags the roll must keep, e.g. ["school_uniform"]')
    }),
    execute: async ({ character, rating, fields, mustInclude }) => {
      const preset = await getCharacterPreset(character);
      if (!preset)
        return {
          found: false,
          note: CHARACTER_DATA_NOTE,
          message: `No character data for ${character}. Call search_character_data first.`
        };
      const rolledFields = (
        fields?.length ? fields : Object.keys(preset.fields)
      ).filter((field) => field !== CHARACTER_FIELD);
      const rolled = await randomizeCharacterFields({
        fields: rolledFields,
        context: preset.fields,
        rating,
        require: mustInclude
      });
      return {
        found: true,
        source: 'character_data',
        note: CHARACTER_DATA_NOTE,
        character: preset.character,
        series: preset.series,
        rating,
        rolledFields,
        fields: { ...preset.fields, ...rolled }
      };
    }
  })
};
