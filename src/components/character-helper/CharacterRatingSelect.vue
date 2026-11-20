<script setup lang="ts">
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { CHARACTER_RATINGS } from '@/services/characterData';
import { useCharacterHelperStore } from '@/stores/characterHelperStore';

const store = useCharacterHelperStore();
</script>

<template>
  <Select v-model="store.rating">
    <SelectTrigger class="h-8 w-32 text-xs capitalize" aria-label="Rating">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup class="max-h-40 overflow-y-auto">
        <SelectItem
          v-for="rating in CHARACTER_RATINGS"
          :key="rating"
          :value="rating"
          class="text-xs capitalize"
        >
          {{ rating }}
        </SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
</template>
