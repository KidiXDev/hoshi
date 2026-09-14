<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  BookOpen,
  Compass,
  Eraser,
  GalleryVerticalEnd,
  HardDrive,
  Image,
  Images,
  Library,
  Workflow,
  Scaling,
  ScanFace,
  Settings,
  Terminal
} from '@lucide/vue';
import appLogoUrl from '@/assets/app-logo.png';
import { BRAND_NAME } from '@/lib/brand';
import DownloadManagerPopover from '@/components/template/DownloadManagerPopover.vue';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { useLauncherStore } from '../../stores/launcherStore';

const route = useRoute();
const router = useRouter();
const lastWikiPath = ref('/danbooru-wiki');
watch(
  () => route.fullPath,
  (path) => {
    if (route.name === 'danbooru-wiki') lastWikiPath.value = path;
  },
  { immediate: true }
);
const launcherStore = useLauncherStore();

// Brand SVG for Civitai (Lucide has no brand icon; class falls through to <svg>)
const CivitaiIcon = {
  render() {
    return h(
      'svg',
      {
        fill: 'currentColor',
        'fill-rule': 'evenodd',
        height: '1em',
        width: '1em',
        viewBox: '0 0 24 24',
        xmlns: 'http://www.w3.org/2000/svg',
        style: 'flex:none;line-height:1'
      },
      [
        h('title', 'Civitai'),
        h('path', {
          d: 'M22.392 6L12 0 1.608 6v12L12 24l10.392-6V6zm-3.407 1.967L12 3.934 5.015 7.967v8.066L12 20.065l6.985-4.032V7.967z'
        }),
        h('path', {
          d: 'M12 6.885l4.43 2.558v1.377h-2.386L12 9.64l-2.044 1.18v2.36L12 14.36l2.044-1.18h2.386v1.377L12 17.115l-4.43-2.558V9.443L12 6.885z'
        })
      ]
    );
  }
};

const navItems = [
  {
    id: 'workflow',
    label: 'Workflow Generator',
    icon: Image,
    route: '/workflow',
    group: 'create'
  },
  {
    id: 'comfyui',
    label: 'ComfyUI',
    icon: Workflow,
    route: '/comfyui',
    group: 'create'
  },
  {
    id: 'upscaler',
    label: 'Image Upscaler',
    icon: Scaling,
    route: '/upscaler',
    group: 'create'
  },
  {
    id: 'remove-background',
    label: 'Remove Background',
    icon: Eraser,
    route: '/remove-background',
    group: 'create'
  },
  {
    id: 'face-detailer',
    label: 'Face Detailer',
    icon: ScanFace,
    route: '/face-detailer',
    group: 'create'
  },
  {
    id: 'viewer',
    label: 'Image Viewer',
    icon: Images,
    route: '/viewer',
    group: 'browse'
  },
  {
    id: 'library',
    label: 'Preset Library',
    icon: Library,
    route: '/library',
    group: 'browse'
  },
  {
    id: 'booru',
    label: 'Booru Gallery',
    icon: GalleryVerticalEnd,
    route: '/booru',
    group: 'browse'
  },
  {
    id: 'animadex',
    label: 'Animadex Explore',
    icon: Compass,
    route: '/animadex',
    group: 'browse'
  },
  {
    id: 'civitai',
    label: 'Civitai Model Browser',
    icon: CivitaiIcon,
    route: '/civitai',
    group: 'browse'
  },
  {
    id: 'models',
    label: 'Model Manager',
    icon: HardDrive,
    route: '/models',
    group: 'browse'
  }
];

const navGroups = computed(() =>
  (['create', 'browse'] as const).map((group) =>
    navItems.filter((item) => item.group === group)
  )
);

function navigate(path: string) {
  router.push(path);
}
</script>

<template>
  <aside
    class="border-sidebar-border bg-sidebar z-30 flex h-full w-14 shrink-0 flex-col items-center justify-between border-r py-3.5 shadow-sm select-none"
  >
    <!-- Top: Logo & Main Navigation -->
    <div class="flex w-full flex-col items-center gap-5">
      <!-- App Brand / Workspace Quick Switch with Tooltip -->
      <Tooltip>
        <TooltipTrigger as-child>
          <div
            class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl transition-all duration-200"
            @click="navigate('/workflow')"
          >
            <img :src="appLogoUrl" alt="" class="h-10 w-10" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" :side-offset="10">
          <p class="font-medium">{{ BRAND_NAME }}</p>
        </TooltipContent>
      </Tooltip>

      <nav class="flex w-full flex-col items-center gap-1.5 px-2">
        <template v-for="(group, gi) in navGroups" :key="gi">
          <Separator v-if="gi > 0" class="my-1 w-6" />
          <Tooltip v-for="item in group" :key="item.id">
            <TooltipTrigger as-child>
              <button
                type="button"
                :aria-label="item.label"
                :aria-current="
                  route.path.startsWith(item.route) ? 'page' : undefined
                "
                class="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-all duration-150"
                :class="[
                  route.path.startsWith(item.route)
                    ? 'border-primary/30 bg-accent text-primary border shadow-xs'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                ]"
                @click="navigate(item.route)"
              >
                <component :is="item.icon" class="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" :side-offset="10">
              <p class="font-medium">{{ item.label }}</p>
            </TooltipContent>
          </Tooltip>
        </template>
      </nav>
    </div>

    <!-- Bottom: Secondary Actions -->
    <div class="flex w-full flex-col items-center gap-2.5 px-2">
      <!-- Settings Button -->
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            class="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-all duration-150"
            :class="[
              route.path.startsWith('/settings')
                ? 'border-primary/30 bg-accent text-primary border shadow-xs'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            ]"
            @click="navigate('/settings')"
          >
            <Settings class="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" :side-offset="10">
          <p class="font-medium">Settings</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            aria-label="ComfyUI Server & Terminal"
            class="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-all duration-150"
            :class="[
              route.path.startsWith('/server')
                ? 'border-primary/30 bg-accent text-primary border shadow-xs'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            ]"
            @click="navigate('/server')"
          >
            <Terminal class="h-4 w-4" />
            <span
              v-if="launcherStore.processStatus === 'running'"
              class="ring-sidebar absolute top-1 right-1 h-2 w-2 rounded-full bg-emerald-500 ring-2"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" :side-offset="10"
          ><p class="font-medium">ComfyUI Server & Terminal</p></TooltipContent
        >
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            aria-label="Danbooru Tag Wiki"
            class="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-all duration-150"
            :class="
              route.path.startsWith('/danbooru-wiki')
                ? 'border-primary/30 bg-accent text-primary border shadow-xs'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            "
            @click="navigate(lastWikiPath)"
          >
            <BookOpen class="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" :side-offset="10"
          ><p class="font-medium">Danbooru Tag Wiki</p></TooltipContent
        >
      </Tooltip>
      <DownloadManagerPopover />
    </div>
  </aside>
</template>
