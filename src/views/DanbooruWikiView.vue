<script setup lang="ts">
import { computed, nextTick, onActivated, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  ExternalLink,
  Layers,
  Loader2,
  Pin,
  RefreshCw,
  RotateCcw,
  Search,
  X
} from '@lucide/vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
import PageLayout from '@/components/layout/PageLayout.vue';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import WikiArticle from '@/components/danbooru/WikiArticle.vue';
import WikiGroups from '@/components/danbooru/WikiGroups.vue';
import WikiSkeleton from '@/components/danbooru/WikiSkeleton.vue';
import {
  DANBOORU_URL,
  fetchWikiPage,
  fetchWikiPosts,
  parseWikiGroups,
  wikiPath,
  wikiPostIds,
  type WikiPage,
  type WikiPost
} from '@/services/danbooruWiki';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauri } from '@tauri-apps/api/core';
import { useWikiPins } from '@/composables/useWikiPins';

defineOptions({ name: 'DanbooruWikiView' });

const route = useRoute();
const router = useRouter();
const viewport = ref<HTMLElement>();
const scrollTop = ref(0);
onActivated(async () => {
  await nextTick();
  if (viewport.value) viewport.value.scrollTop = scrollTop.value;
});

const title = ref(String(route.params.title || 'tag_groups'));
watch(
  () => route.fullPath,
  () => {
    if (route.name === 'danbooru-wiki')
      title.value = String(route.params.title || 'tag_groups');
  }
);
const isIndex = computed(() => title.value === 'tag_groups');

const page = shallowRef<WikiPage>();
const posts = shallowRef<WikiPost[]>([]);
const loading = ref(true);
const loadingImages = ref(false);
const error = ref('');
const imageError = ref('');
const search = ref('');
const retry = ref(0);

const groups = computed(() => parseWikiGroups(page.value?.body || ''));
const displayTitle = computed(() =>
  (page.value?.title || title.value).replaceAll('_', ' ')
);

const { pins, togglePin } = useWikiPins();

watch(
  [title, retry],
  async (_, __, onCleanup) => {
    const controller = new AbortController();
    onCleanup(() => controller.abort());

    page.value = undefined;
    posts.value = [];
    loading.value = true;
    loadingImages.value = false;
    error.value = '';
    imageError.value = '';

    try {
      const result = await fetchWikiPage(title.value, controller.signal);
      if (controller.signal.aborted) return;
      page.value = result;
      loading.value = false;

      const ids = wikiPostIds(result.body);
      if (ids.length > 0) {
        loadingImages.value = true;
        try {
          const resultPosts = await fetchWikiPosts(ids, controller.signal);
          if (!controller.signal.aborted) {
            posts.value = resultPosts;
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            imageError.value = `Post previews could not be loaded (${String(err)}). Links are still active.`;
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        error.value = err instanceof Error ? err.message : String(err);
      }
    } finally {
      if (!controller.signal.aborted) {
        loading.value = false;
        loadingImages.value = false;
      }
    }
  },
  { immediate: true }
);

function handleSearch() {
  const q = search.value.trim();
  if (q) {
    search.value = '';
    void router.push(wikiPath(q));
  }
}

async function openOfficial() {
  const url = `${DANBOORU_URL}/wiki_pages/${encodeURIComponent(title.value)}`;
  if (isTauri()) {
    await openUrl(url).catch(console.error);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
</script>

<template>
  <PageLayout
    title="Danbooru Tag Wiki"
    :subtitle="
      isIndex
        ? 'Explore tag groups, visual taxonomy, and prompt vocabulary'
        : 'Tag definition, usage guidelines, and examples from Danbooru'
    "
    content-class="flex flex-col overflow-hidden p-0"
  >
    <template #icon>
      <BookOpen class="size-4" />
    </template>
    <template #title-extra>
      <Badge
        variant="outline"
        class="border-primary/30 text-primary h-4 px-1.5 text-xs font-normal"
      >
        Knowledge Base
      </Badge>
    </template>
    <template #actions>
      <div class="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="sm"
              class="h-8 gap-1.5 text-xs"
              :disabled="loading"
              @click="retry++"
            >
              <RefreshCw
                class="size-3.5"
                :class="{ 'animate-spin': loading }"
              />
              <span class="hidden sm:inline">Reload</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reload wiki page</TooltipContent>
        </Tooltip>

        <Button
          variant="outline"
          size="sm"
          class="h-8 gap-1.5 text-xs"
          @click="openOfficial"
        >
          <ExternalLink class="size-3.5" />
          <span class="hidden sm:inline">Official Wiki</span>
        </Button>
      </div>
    </template>

    <template #below-header>
      <div
        class="border-border/80 bg-card/70 shrink-0 space-y-2.5 border-b px-5 py-3 backdrop-blur-md"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <Breadcrumb class="text-xs">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink as-child>
                  <RouterLink
                    to="/danbooru-wiki"
                    class="hover:text-primary flex items-center gap-1.5 font-medium transition-colors"
                  >
                    <Layers class="size-3.5" />
                    <span>Tag Groups</span>
                  </RouterLink>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <template v-if="!isIndex">
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage
                    class="text-foreground max-w-64 truncate font-semibold capitalize"
                  >
                    {{ displayTitle }}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </template>
            </BreadcrumbList>
          </Breadcrumb>

          <!-- Global jump-to-tag search -->
          <form
            class="flex w-full max-w-xs items-center gap-2 sm:max-w-sm"
            @submit.prevent="handleSearch"
          >
            <div class="relative flex-1">
              <Search
                class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2"
              />
              <Input
                v-model="search"
                placeholder="Open tag wiki (e.g. blue eyes)…"
                class="border-border bg-secondary/50 focus:bg-background h-8 pr-7 pl-8 text-xs transition-colors"
                aria-label="Open tag wiki page"
              />
              <button
                v-if="search"
                type="button"
                class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                @click="search = ''"
              >
                <X class="size-3" />
              </button>
            </div>
            <Button
              type="submit"
              size="sm"
              class="h-8 px-3 text-xs"
              :disabled="!search.trim()"
            >
              Go
            </Button>
          </form>
        </div>

        <!-- Pinned tags -->
        <div v-if="pins.length" class="flex flex-wrap items-center gap-1.5">
          <span
            class="text-muted-foreground flex items-center gap-1 pr-1 text-xs font-medium"
          >
            <Pin class="size-3 text-amber-400" />
            Pinned
          </span>
          <div
            v-for="tag in pins"
            :key="tag"
            class="group border-border/60 bg-secondary/40 hover:border-primary/50 hover:bg-secondary/80 flex items-center gap-1 rounded-md border pl-2 text-xs transition-colors"
            :class="{ 'border-primary/60 text-primary': tag === title }"
          >
            <RouterLink
              :to="wikiPath(tag)"
              class="py-0.5 font-medium capitalize"
            >
              {{ tag.replaceAll('_', ' ') }}
            </RouterLink>
            <button
              type="button"
              :title="`Unpin ${tag}`"
              class="text-muted-foreground hover:text-foreground cursor-pointer px-1.5 py-1 opacity-0 transition-opacity group-hover:opacity-100"
              @click="togglePin(tag)"
            >
              <X class="size-3" />
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Main Viewport -->
    <main
      ref="viewport"
      @scroll="scrollTop = viewport?.scrollTop ?? 0"
      class="h-full min-h-0 flex-1 overflow-hidden"
      :class="{ 'overflow-y-auto': !isIndex }"
    >
      <!-- Loading Skeleton State -->
      <div v-if="loading" class="h-full" :class="{ 'p-5 lg:p-7': !isIndex }">
        <WikiSkeleton :mode="isIndex ? 'groups' : 'article'" />
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="mx-auto max-w-lg p-5 py-12">
        <Alert
          variant="destructive"
          class="border-destructive/40 bg-destructive/10 space-y-3"
        >
          <AlertCircle class="size-4" />
          <AlertTitle class="text-sm font-semibold"
            >Failed to load wiki page</AlertTitle
          >
          <AlertDescription class="text-xs leading-relaxed">
            {{ error }}
          </AlertDescription>
          <div class="mt-4 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              class="text-xs"
              @click="retry++"
            >
              <RotateCcw class="mr-1.5 size-3.5" />
              Try again
            </Button>
            <Button
              v-if="!isIndex"
              variant="ghost"
              size="sm"
              class="text-xs"
              @click="router.push('/danbooru-wiki')"
            >
              <ArrowLeft class="mr-1.5 size-3.5" />
              All Tag Groups
            </Button>
          </div>
        </Alert>
      </div>

      <!-- Loaded Content State -->
      <template v-else-if="page">
        <!-- Tag Groups Index Mode: Full-height 2-pane master-detail -->
        <WikiGroups v-if="isIndex" :groups="groups" class="h-full" />

        <!-- Individual Tag Article Mode: Full-width modern document container -->
        <div v-else class="w-full space-y-6 p-6">
          <!-- Image Previews Loading Status -->
          <div
            v-if="loadingImages"
            class="border-border/60 bg-card/50 text-muted-foreground flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
          >
            <Loader2 class="text-primary size-3.5 animate-spin" />
            <span>Fetching visual post examples from Danbooru…</span>
          </div>

          <!-- Image Previews Error Notice -->
          <NoticeBanner v-if="imageError">
            <span>{{ imageError }}</span>
            <template #actions>
              <Button
                variant="ghost"
                size="sm"
                class="h-6 px-2 text-xs text-amber-300 hover:bg-amber-500/20"
                @click="retry++"
              >
                Retry
              </Button>
            </template>
          </NoticeBanner>

          <!-- Wiki Article Body & Actions -->
          <WikiArticle
            :key="page.title"
            :title="page.title"
            :body="page.body"
            :posts="posts"
            :updated-at="page.updated_at"
          />
        </div>
      </template>
    </main>
  </PageLayout>
</template>
