<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  BookOpen,
  Box,
  Copy,
  Folder,
  Gamepad2,
  Globe,
  Layers,
  Paintbrush,
  Palette,
  Pin,
  Search,
  SearchX,
  Shirt,
  Tag,
  User,
  Users,
  X
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { wikiPath, type WikiGroup } from '@/services/danbooruWiki';
import { useWikiPins } from '@/composables/useWikiPins';

interface Section {
  title: string;
  links: { title: string; label: string; depth: number }[];
}

const props = defineProps<{ groups: WikiGroup[] }>();

const router = useRouter();
const { isPinned, togglePin } = useWikiPins();

const groupQuery = ref('');
const activeGroupKey = ref('');

function getGroupIcon(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes('body')) return User;
  if (
    lower.includes('attire') ||
    lower.includes('cloth') ||
    lower.includes('accessor')
  )
    return Shirt;
  if (lower.includes('composition') || lower.includes('style')) return Palette;
  if (lower.includes('object') || lower.includes('armor')) return Box;
  if (lower.includes('character') || lower.includes('mascot')) return Users;
  if (lower.includes('artist') || lower.includes('drawfag')) return Paintbrush;
  if (lower.includes('game')) return Gamepad2;
  if (
    lower.includes('real world') ||
    lower.includes('location') ||
    lower.includes('compan')
  )
    return Globe;
  if (lower.includes('metatag')) return Tag;
  return Folder;
}

const filteredGroups = computed(() => {
  const q = groupQuery.value.trim().toLowerCase();
  if (!q) return props.groups;

  return props.groups.filter((group) => {
    return (
      group.title.toLowerCase().includes(q) ||
      group.category.toLowerCase().includes(q) ||
      group.links.some((l) => l.label.toLowerCase().includes(q))
    );
  });
});

const groupedByCategory = computed(() => {
  const map = new Map<string, WikiGroup[]>();
  for (const group of filteredGroups.value) {
    const cat = group.category || 'General';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)?.push(group);
  }
  return Array.from(map.entries()).map(([category, groups]) => ({
    category,
    groups
  }));
});

const totalTopicsAcrossAllGroups = computed(() =>
  props.groups.reduce((acc, g) => acc + g.links.length, 0)
);

const activeGroup = computed(() => {
  if (filteredGroups.value.length === 0) return null;
  if (activeGroupKey.value) {
    const found = filteredGroups.value.find(
      (g) => `${g.category}:${g.title}` === activeGroupKey.value
    );
    if (found) return found;
  }
  return filteredGroups.value[0];
});

watch(
  filteredGroups,
  (groups) => {
    if (groups.length === 0) {
      activeGroupKey.value = '';
      return;
    }
    const currentValid = groups.some(
      (g) => `${g.category}:${g.title}` === activeGroupKey.value
    );
    if (!currentValid && groups[0]) {
      activeGroupKey.value = `${groups[0].category}:${groups[0].title}`;
    }
  },
  { immediate: true }
);

function selectGroup(group: WikiGroup) {
  activeGroupKey.value = `${group.category}:${group.title}`;
}

const sections = computed<Section[]>(() => {
  if (!activeGroup.value) return [];
  const links = activeGroup.value.links;
  const hasSub = links.some((l) => l.depth > 0);

  if (!hasSub) {
    return [{ title: 'All Topics', links }];
  }

  const result: Section[] = [];
  let currentSection: Section | null = null;
  const standalone: typeof links = [];

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const next = links[i + 1];

    if (link.depth === 0) {
      if (next && next.depth > 0) {
        currentSection = { title: link.label, links: [link] };
        result.push(currentSection);
      } else {
        currentSection = null;
        standalone.push(link);
      }
    } else if (currentSection) {
      currentSection.links.push(link);
    } else {
      standalone.push(link);
    }
  }

  if (standalone.length > 0) {
    result.push({ title: 'General Topics', links: standalone });
  }

  return result;
});

const searchResults = computed(() => {
  const q = groupQuery.value.trim().toLowerCase();
  if (!q) return [];
  return props.groups.flatMap((group) =>
    group.links
      .filter((link) => `${link.label} ${link.title}`.toLowerCase().includes(q))
      .map((link) => ({ ...link, group: group.title }))
  );
});

function handlePin(tag: string, event?: Event) {
  event?.stopPropagation();
  toast.success(togglePin(tag) ? `Pinned "${tag}"` : `Unpinned "${tag}"`);
}

function handleCopyTag(tag: string, event?: Event) {
  event?.stopPropagation();
  void navigator.clipboard.writeText(tag);
  toast.success(`Copied "${tag}"`);
}
</script>

<template>
  <div class="flex h-full min-h-0 w-full overflow-hidden select-none">
    <!-- Left Sidebar: Categorized Taxonomy Navigator -->
    <aside
      class="border-border/60 bg-card/20 flex w-72 shrink-0 flex-col border-r sm:w-80"
    >
      <!-- Search Filter Bar -->
      <div class="border-border/50 border-b p-3">
        <div class="relative w-full">
          <Search
            class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          />
          <Input
            v-model="groupQuery"
            class="border-border/60 bg-secondary/40 focus:bg-background h-8 pr-7 pl-8 text-xs transition-colors"
            placeholder="Search collections or topics…"
          />
          <button
            v-if="groupQuery"
            type="button"
            class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer"
            @click="groupQuery = ''"
          >
            <X class="size-3" />
          </button>
        </div>
      </div>

      <!-- Categorized Collections List -->
      <div class="flex-1 space-y-4 overflow-y-auto p-2">
        <div
          v-if="groupedByCategory.length === 0"
          class="text-muted-foreground py-12 text-center text-xs"
        >
          <p>No collections found matching "{{ groupQuery }}"</p>
          <Button
            variant="ghost"
            size="sm"
            class="mt-2 h-7 text-xs"
            @click="groupQuery = ''"
          >
            Clear search
          </Button>
        </div>

        <div
          v-for="catGroup in groupedByCategory"
          :key="catGroup.category"
          class="space-y-1"
        >
          <!-- Category Section Header -->
          <div
            class="text-muted-foreground/70 flex items-center justify-between px-2.5 py-1 text-xs font-semibold tracking-wider uppercase"
          >
            <span class="truncate">{{ catGroup.category }}</span>
            <span class="font-mono text-xs opacity-70">
              {{ catGroup.groups.length }}
            </span>
          </div>

          <!-- Collection Buttons -->
          <div class="space-y-0.5">
            <button
              v-for="group in catGroup.groups"
              :key="`${group.category}:${group.title}`"
              type="button"
              class="flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors"
              :class="
                activeGroup &&
                activeGroup.title === group.title &&
                activeGroup.category === group.category
                  ? 'bg-primary/10 text-primary border-primary border-l-2 pl-2 font-semibold'
                  : 'hover:bg-muted/60 text-muted-foreground hover:text-foreground'
              "
              @click="selectGroup(group)"
            >
              <div class="flex min-w-0 flex-1 items-center gap-2.5">
                <component
                  :is="getGroupIcon(group.title)"
                  class="size-3.5 shrink-0"
                  :class="
                    activeGroup &&
                    activeGroup.title === group.title &&
                    activeGroup.category === group.category
                      ? 'text-primary'
                      : 'opacity-60'
                  "
                />
                <span class="truncate">{{ group.title }}</span>
              </div>

              <span
                class="rounded px-1.5 py-0.5 font-mono text-xs"
                :class="
                  activeGroup &&
                  activeGroup.title === group.title &&
                  activeGroup.category === group.category
                    ? 'bg-primary/20 text-primary font-bold'
                    : 'bg-secondary/60 text-muted-foreground'
                "
              >
                {{ group.links.length }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- Directory Footer Status -->
      <div
        class="border-border/50 text-muted-foreground bg-muted/10 flex items-center justify-between border-t px-3.5 py-2.5 text-xs"
      >
        <span class="flex items-center gap-1.5">
          <Layers class="text-primary/80 size-3.5" />
          <span>{{ filteredGroups.length }} collections</span>
        </span>
        <span class="font-mono">{{ totalTopicsAcrossAllGroups }} topics</span>
      </div>
    </aside>

    <!-- Right Main Pane: Topics Explorer -->
    <section class="bg-background flex flex-1 flex-col overflow-hidden">
      <!-- Collection Header Bar -->
      <div
        v-if="activeGroup"
        class="border-border/50 flex shrink-0 flex-wrap items-center justify-between gap-4 border-b px-6 py-3.5"
      >
        <div class="flex flex-col gap-0.5">
          <div class="flex items-center gap-2">
            <span
              class="border-border bg-secondary/80 text-secondary-foreground rounded px-1.5 py-0.5 text-xs font-medium"
            >
              {{ activeGroup.category }}
            </span>
            <span class="text-muted-foreground font-mono text-xs">
              {{ activeGroup.links.length }} topics
            </span>
          </div>
          <h2 class="text-foreground text-lg font-bold tracking-tight">
            {{ activeGroup.title }}
          </h2>
        </div>

        <div class="flex flex-wrap items-center gap-2.5">
          <!-- Open Main Wiki Button -->
          <Button
            variant="outline"
            size="sm"
            class="h-8 gap-1.5 text-xs font-medium"
            @click="router.push(wikiPath(activeGroup.title))"
          >
            <BookOpen class="text-primary size-3.5" />
            <span>Open Guide</span>
          </Button>
        </div>
      </div>

      <!-- Topics Content Area -->
      <div v-if="activeGroup" class="flex-1 overflow-y-auto p-6">
        <!-- Search Filtered Results State -->
        <div v-if="groupQuery.trim()" class="space-y-4">
          <div
            class="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
          >
            Matching Topics ({{ searchResults.length }})
          </div>

          <div v-if="searchResults.length" class="flex flex-wrap gap-2">
            <div
              v-for="link in searchResults"
              :key="`${link.group}:${link.title}`"
              class="group border-border/60 bg-secondary/30 hover:bg-secondary/70 hover:border-primary/50 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors"
              @click="router.push(wikiPath(link.title))"
            >
              <span
                class="text-foreground group-hover:text-primary font-medium capitalize transition-colors"
              >
                {{ link.label }}
              </span>
              <span class="text-muted-foreground/70 truncate text-xs">
                {{ link.group }}
              </span>

              <!-- Hover Quick Actions -->
              <div
                class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <button
                  type="button"
                  title="Copy tag"
                  class="text-muted-foreground hover:text-foreground cursor-pointer p-0.5 transition-colors"
                  @click="handleCopyTag(link.title, $event)"
                >
                  <Copy class="size-3" />
                </button>
                <button
                  type="button"
                  :title="isPinned(link.title) ? 'Unpin' : 'Pin'"
                  class="cursor-pointer p-0.5 transition-colors hover:text-amber-400"
                  :class="
                    isPinned(link.title)
                      ? 'text-amber-400'
                      : 'text-muted-foreground'
                  "
                  @click="handlePin(link.title, $event)"
                >
                  <Pin class="size-3" />
                </button>
              </div>
            </div>
          </div>

          <!-- Empty search match -->
          <div
            v-else
            class="text-muted-foreground flex flex-col items-center justify-center py-20 text-center text-xs"
          >
            <SearchX class="mb-2.5 size-7 opacity-40" />
            <p class="text-sm font-medium">
              No topics match “{{ groupQuery }}”
            </p>
            <p class="text-muted-foreground mt-1 text-xs">
              Try a different keyword or clear the filter.
            </p>
            <Button
              variant="ghost"
              size="sm"
              class="mt-3 h-7 text-xs"
              @click="groupQuery = ''"
            >
              Clear search
            </Button>
          </div>
        </div>

        <div v-else class="space-y-6">
          <div
            v-for="section in sections"
            :key="section.title"
            class="space-y-3"
          >
            <div
              class="border-border/40 flex items-center gap-2 border-b pb-1.5"
            >
              <span
                class="text-muted-foreground text-xs font-bold tracking-wider uppercase"
              >
                {{ section.title }}
              </span>
              <span class="text-muted-foreground/60 font-mono text-xs">
                ({{ section.links.length }})
              </span>
            </div>

            <div class="flex flex-wrap gap-2">
              <div
                v-for="link in section.links"
                :key="link.title"
                class="group border-border/60 bg-secondary/30 hover:bg-secondary/70 hover:border-primary/50 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors"
                @click="router.push(wikiPath(link.title))"
              >
                <span
                  class="text-foreground group-hover:text-primary font-medium capitalize transition-colors"
                >
                  {{ link.label }}
                </span>

                <!-- Quick actions on hover -->
                <div
                  class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <button
                    type="button"
                    title="Copy tag"
                    class="text-muted-foreground hover:text-foreground cursor-pointer p-0.5 transition-colors"
                    @click="handleCopyTag(link.title, $event)"
                  >
                    <Copy class="size-3" />
                  </button>
                  <button
                    type="button"
                    :title="isPinned(link.title) ? 'Unpin' : 'Pin'"
                    class="cursor-pointer p-0.5 transition-colors hover:text-amber-400"
                    :class="
                      isPinned(link.title)
                        ? 'text-amber-400'
                        : 'text-muted-foreground'
                    "
                    @click="handlePin(link.title, $event)"
                  >
                    <Pin class="size-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
