<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Dices, ExternalLink, Plus, Replace, Shirt } from '@lucide/vue';
import CharacterFieldInput from '@/components/character-helper/CharacterFieldInput.vue';
import CharacterRatingSelect from '@/components/character-helper/CharacterRatingSelect.vue';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import {
  CHARACTER_FIELD,
  type CharacterSuggestion
} from '@/services/characterData';
import { useCharacterHelperStore } from '@/stores/characterHelperStore';

const store = useCharacterHelperStore();
const router = useRouter();
const open = ref<string>();

watch(open, (value) => {
  if (value) void store.run(store.load);
});

function pickCharacter(item: CharacterSuggestion) {
  if (item.kind === 'character') store.setCharacter(item.tag, item.series);
}
</script>

<template>
  <Accordion v-model="open" type="single" collapsible class="w-full">
    <AccordionItem value="character-helper" class="border-none">
      <AccordionTrigger
        class="hover:bg-accent rounded-lg px-3 py-2.5 hover:no-underline"
      >
        <div class="flex w-full items-center justify-between pr-3">
          <span
            class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
          >
            Character Helper
          </span>
          <span
            v-if="store.character"
            class="border-primary/30 bg-primary/10 text-primary max-w-40 truncate rounded border px-2 py-0.5 font-mono text-xs font-bold"
          >
            {{ store.character.replaceAll('_', ' ') }}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent class="px-2.5 pt-2">
        <div class="flex flex-col gap-2.5">
          <CharacterFieldInput
            :field="CHARACTER_FIELD"
            :model-value="store.fields[CHARACTER_FIELD] ?? []"
            placeholder="Search a character..."
            @update:model-value="store.setField(CHARACTER_FIELD, $event)"
            @pick="pickCharacter"
          />
          <div class="flex items-center gap-2">
            <CharacterRatingSelect />
            <Button
              size="sm"
              variant="outline"
              class="h-8 flex-1 text-xs"
              :disabled="store.busy || !store.character"
              @click="store.run(store.usualLook)"
            >
              <Shirt class="size-3.5" /> Usual look
            </Button>
            <Button
              size="sm"
              class="h-8 flex-1 text-xs"
              :disabled="store.busy"
              @click="store.run(() => store.roll())"
            >
              <Dices class="size-3.5" /> Roll
            </Button>
          </div>
          <CharacterFieldInput
            v-model="store.mustInclude"
            field=""
            placeholder="Must include (kept by every roll)..."
          />
          <p
            class="border-border bg-muted/40 max-h-28 min-h-12 overflow-y-auto rounded-md border p-2 font-mono text-xs break-words select-text"
            :class="{ 'text-muted-foreground': !store.prompt }"
          >
            {{ store.prompt || 'Pick a character, then Usual look or Roll' }}
          </p>
          <div class="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              class="h-7 flex-1 text-xs"
              :disabled="!store.prompt"
              @click="store.sendToPrompt('append')"
            >
              <Plus class="size-3" /> Append
            </Button>
            <Button
              size="sm"
              variant="secondary"
              class="h-7 flex-1 text-xs"
              :disabled="!store.prompt"
              @click="store.sendToPrompt('replace')"
            >
              <Replace class="size-3" /> Replace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              class="h-7 text-xs"
              title="Edit every field, locks and dice"
              @click="router.push('/character-helper')"
            >
              <ExternalLink class="size-3" /> Full builder
            </Button>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  </Accordion>
</template>
