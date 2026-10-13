<script setup lang="ts">
import { CheckCircle2, XCircle } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useGalleryCacheStore } from '@/stores/galleryCacheStore';

const galleryCache = useGalleryCacheStore();
const { progress, percent, isRebuilding, isDialogOpen, indexedCount, error } =
  storeToRefs(galleryCache);
</script>

<template>
  <Dialog v-model:open="isDialogOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Re-indexing output images</DialogTitle>
        <DialogDescription>
          Every thumbnail is regenerated. Large output folders can take a while
          and keep the CPU busy.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3">
        <Progress
          :model-value="isRebuilding && !progress.total ? 15 : percent"
          class="h-2"
          :class="{ 'animate-pulse': isRebuilding && !progress.total }"
        />
        <div
          class="text-muted-foreground flex items-center justify-between gap-3 font-mono text-xs"
        >
          <span class="min-w-0 flex-1 truncate">
            {{ isRebuilding ? progress.stage : error ? 'Failed' : 'Finished' }}
          </span>
          <span class="shrink-0">
            {{ progress.processed }} / {{ progress.total || '—' }}
          </span>
        </div>

        <NoticeBanner v-if="!isRebuilding && error" tone="destructive">
          <template #icon>
            <XCircle class="h-4 w-4 shrink-0" />
          </template>
          {{ error }}
        </NoticeBanner>
        <NoticeBanner v-else-if="!isRebuilding" tone="emerald">
          <template #icon>
            <CheckCircle2 class="h-4 w-4 shrink-0" />
          </template>
          Indexed {{ indexedCount.toLocaleString() }}
          {{ indexedCount === 1 ? 'image' : 'images' }}.
        </NoticeBanner>
      </div>

      <DialogFooter>
        <Button
          v-if="isRebuilding"
          variant="outline"
          @click="isDialogOpen = false"
        >
          Run in background
        </Button>
        <Button v-else @click="isDialogOpen = false">Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
