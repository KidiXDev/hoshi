<script setup lang="ts">
import ModelSection from './ModelSection.vue';
import LoraChainSection from './LoraChainSection.vue';
import SeedControl from '../common/SeedControl.vue';
import { useFaceDetailerStore } from '@/stores/faceDetailerStore';

const detailer = useFaceDetailerStore();
</script>

<template>
  <div class="flex flex-col gap-3">
    <ModelSection :models="detailer.state.models" />
    <LoraChainSection
      v-model:loras="detailer.state.loras"
      v-model:positive-prompt="detailer.state.settings.positivePrompt"
    />
    <SeedControl v-model="detailer.state.seed" />
  </div>
</template>
