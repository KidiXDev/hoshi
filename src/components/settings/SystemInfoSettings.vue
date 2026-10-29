<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core';
import {
  Activity,
  Boxes,
  Cpu,
  Gpu,
  HardDrive,
  Loader2,
  MemoryStick,
  Monitor
} from '@lucide/vue';
import {
  computed,
  onActivated,
  onDeactivated,
  onMounted,
  ref,
  shallowRef
} from 'vue';
import NoticeBanner from '@/components/layout/NoticeBanner.vue';
import SettingsSection from '@/components/layout/SettingsSection.vue';
import SystemSpecList from '@/components/settings/SystemSpecList.vue';
import UsageSparkline from '@/components/settings/UsageSparkline.vue';
import {
  getSystemSpecs,
  getSystemUsage,
  type GpuUsage,
  type SystemSpecs,
  type SystemUsage
} from '@/services/systemInfo';
import { useComfyStore } from '@/stores/comfyStore';
import { formatFileSize } from '@/utils/formatters';

type SpecRows = [label: string, value: string][];

interface UsageTile {
  key: string;
  label: string;
  value: string;
  detail: string;
  history: number[];
}

const HISTORY_LENGTH = 60;
const POLL_INTERVAL_MS = 1000;
const LOW_SPACE_RATIO = 0.9;

const comfyStore = useComfyStore();
const specs = shallowRef<SystemSpecs | null>(null);
const specsError = ref('');
const usage = shallowRef<SystemUsage | null>(null);
const cpuHistory = shallowRef<number[]>([]);
const memoryHistory = shallowRef<number[]>([]);
const gpuHistory = shallowRef<
  Record<string, { load: number[]; memory: number[] }>
>({});
let polling = false;

function percent(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0;
}

function appendSample(history: number[], value: number) {
  return [...history, value].slice(-HISTORY_LENGTH);
}

function gpuKey(gpu: GpuUsage, index: number) {
  return `${index}:${gpu.name}`;
}

function formatFrequency(mhz: number) {
  return mhz >= 1000 ? `${(mhz / 1000).toFixed(2)} GHz` : `${mhz} MHz`;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days && `${days}d`, (days || hours) && `${hours}h`, `${minutes}m`]
    .filter(Boolean)
    .join(' ');
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const next = await getSystemUsage();
    usage.value = next;
    cpuHistory.value = appendSample(cpuHistory.value, next.cpuUsage);
    memoryHistory.value = appendSample(
      memoryHistory.value,
      percent(next.usedMemory, next.totalMemory)
    );
    gpuHistory.value = Object.fromEntries(
      next.gpus.map((gpu, index) => {
        const previous = gpuHistory.value[gpuKey(gpu, index)];
        return [
          gpuKey(gpu, index),
          {
            load: appendSample(previous?.load ?? [], gpu.utilization),
            memory: appendSample(
              previous?.memory ?? [],
              percent(gpu.memoryUsed, gpu.memoryTotal)
            )
          }
        ];
      })
    );
  } catch (error) {
    console.warn('Failed to read system usage:', error);
  } finally {
    polling = false;
  }
}

const { pause, resume } = useIntervalFn(poll, POLL_INTERVAL_MS, {
  immediate: false
});

onMounted(async () => {
  void poll();
  resume();
  try {
    specs.value = await getSystemSpecs();
  } catch (error) {
    specsError.value = String(error);
  }
});
onActivated(resume);
onDeactivated(pause);

const tiles = computed<UsageTile[]>(() => {
  const current = usage.value;
  if (!current) return [];
  return [
    {
      key: 'cpu',
      label: 'CPU',
      value: `${Math.round(current.cpuUsage)}%`,
      detail: `${current.coreUsage.length} threads · ${formatFrequency(current.cpuFrequencyMhz)}`,
      history: cpuHistory.value
    },
    {
      key: 'memory',
      label: 'Memory',
      value: `${Math.round(percent(current.usedMemory, current.totalMemory))}%`,
      detail: `${formatFileSize(current.usedMemory)} of ${formatFileSize(current.totalMemory)}`,
      history: memoryHistory.value
    },
    ...current.gpus.flatMap((gpu, index) => {
      const history = gpuHistory.value[gpuKey(gpu, index)];
      const prefix = current.gpus.length > 1 ? `GPU ${index}` : 'GPU';
      return [
        {
          key: `${gpuKey(gpu, index)}:load`,
          label: `${prefix} load`,
          value: `${Math.round(gpu.utilization)}%`,
          detail: [
            gpu.name,
            gpu.temperature === null ? '' : `${gpu.temperature}°C`,
            gpu.powerDraw === null ? '' : `${gpu.powerDraw.toFixed(0)} W`
          ]
            .filter(Boolean)
            .join(' · '),
          history: history?.load ?? []
        },
        {
          key: `${gpuKey(gpu, index)}:memory`,
          label: `${prefix} VRAM`,
          value: `${Math.round(percent(gpu.memoryUsed, gpu.memoryTotal))}%`,
          detail: `${formatFileSize(gpu.memoryUsed)} of ${formatFileSize(gpu.memoryTotal)}`,
          history: history?.memory ?? []
        }
      ];
    })
  ];
});

const osRows = computed<SpecRows>(() => {
  const info = specs.value;
  if (!info) return [];
  return [
    ['Operating system', info.osName],
    ['Version', info.osVersion],
    ['Kernel', info.kernelVersion],
    ['Architecture', info.architecture],
    ['Device name', info.hostName],
    ['Uptime', usage.value ? formatUptime(usage.value.uptime) : ''],
    ['Last boot', new Date(info.bootTime * 1000).toLocaleString()]
  ];
});

const cpuRows = computed<SpecRows>(() => {
  const info = specs.value;
  if (!info) return [];
  return [
    ['Processor', info.cpuBrand],
    ['Vendor', info.cpuVendor],
    ['Cores', info.physicalCores?.toString() ?? ''],
    ['Threads', info.logicalCores.toString()],
    [
      'Current clock',
      usage.value ? formatFrequency(usage.value.cpuFrequencyMhz) : ''
    ]
  ];
});

const memoryRows = computed<SpecRows>(() => {
  const info = specs.value;
  if (!info) return [];
  const current = usage.value;
  return [
    ['Installed', formatFileSize(info.totalMemory)],
    ['In use', current ? formatFileSize(current.usedMemory) : ''],
    ['Available', current ? formatFileSize(current.availableMemory) : ''],
    [
      'Page file',
      current
        ? `${formatFileSize(current.usedSwap)} of ${formatFileSize(info.totalSwap)}`
        : formatFileSize(info.totalSwap)
    ]
  ];
});

const gpuCards = computed(() =>
  (specs.value?.gpus ?? []).map((gpu) => {
    const live = usage.value?.gpus.find((item) => item.name === gpu.name);
    const rows: SpecRows = [
      ['Vendor', gpu.vendor],
      [
        'Dedicated VRAM',
        formatFileSize(live?.memoryTotal ?? gpu.dedicatedMemory)
      ],
      ['Shared memory', formatFileSize(gpu.sharedMemory)],
      ['Driver version', gpu.driverVersion ?? '']
    ];
    if (live) {
      rows.push(
        [
          'VRAM in use',
          `${formatFileSize(live.memoryUsed)} of ${formatFileSize(live.memoryTotal)}`
        ],
        ['Load', `${Math.round(live.utilization)}%`],
        [
          'Temperature',
          live.temperature === null ? '' : `${live.temperature}°C`
        ],
        [
          'Power draw',
          live.powerDraw === null
            ? ''
            : `${live.powerDraw.toFixed(1)} W${live.powerLimit === null ? '' : ` of ${live.powerLimit.toFixed(0)} W`}`
        ]
      );
    }
    return { name: gpu.name, rows };
  })
);
const hasLiveGpu = computed(() => (usage.value?.gpus.length ?? 0) > 0);

const disks = computed(() =>
  (specs.value?.disks ?? []).map((disk) => {
    const used = disk.totalSpace - disk.availableSpace;
    const ratio = disk.totalSpace > 0 ? used / disk.totalSpace : 0;
    return {
      key: disk.mountPoint,
      title: disk.name ? `${disk.name} (${disk.mountPoint})` : disk.mountPoint,
      details: [disk.kind, disk.fileSystem, disk.removable ? 'Removable' : '']
        .filter((part) => part && part !== 'Unknown')
        .join(' · '),
      usedPercent: ratio * 100,
      lowSpace: ratio >= LOW_SPACE_RATIO,
      summary: `${formatFileSize(disk.availableSpace)} free of ${formatFileSize(disk.totalSpace)}`
    };
  })
);

const runtimeRows = computed<SpecRows>(() => {
  const runtime = comfyStore.bridgeSystem;
  if (!comfyStore.isConnected || !runtime?.success) return [];
  return [
    ['Python', runtime.python_version.split(' ')[0] ?? ''],
    ['PyTorch', runtime.torch_version],
    [
      'CUDA',
      runtime.cuda_available
        ? (runtime.cuda_version ?? 'Available')
        : 'Not available'
    ],
    ...runtime.devices.map((device): [string, string] => [
      `Device ${device.index}`,
      `${device.name} · compute ${device.major}.${device.minor} · ${formatFileSize(device.free_vram_mb * 1024 * 1024)} free of ${formatFileSize(device.total_vram_mb * 1024 * 1024)}`
    ])
  ];
});
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Live usage -->
    <SettingsSection
      title="Live usage"
      description="Updated every second while this page is open."
      icon-class="text-emerald-400"
    >
      <template #icon>
        <Activity class="h-3.5 w-3.5" />
      </template>

      <div
        v-if="tiles.length === 0"
        class="text-muted-foreground flex items-center gap-2 text-xs"
      >
        <Loader2 class="h-3.5 w-3.5 animate-spin" />
        Reading usage…
      </div>
      <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div
          v-for="tile in tiles"
          :key="tile.key"
          class="border-border/60 bg-muted/20 flex min-w-0 flex-col gap-2 rounded-lg border p-3"
        >
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-muted-foreground text-xs">{{ tile.label }}</span>
            <span class="text-foreground text-lg font-semibold">
              {{ tile.value }}
            </span>
          </div>
          <p
            class="text-muted-foreground -mt-1.5 truncate text-xs"
            :title="tile.detail"
          >
            {{ tile.detail }}
          </p>
          <UsageSparkline
            :values="tile.history"
            :capacity="HISTORY_LENGTH"
            :label="tile.label"
          />
          <div
            v-if="tile.key === 'cpu' && usage"
            class="flex h-8 items-end gap-0.5"
            aria-label="Load per thread"
          >
            <div
              v-for="(load, index) in usage.coreUsage"
              :key="index"
              class="bg-primary/15 relative h-full max-w-6 flex-1 overflow-hidden rounded-t-sm"
              :title="`Thread ${index + 1}: ${Math.round(load)}%`"
            >
              <div
                class="bg-primary absolute inset-x-0 bottom-0 rounded-t-sm"
                :style="{ height: `${Math.min(100, Math.max(0, load))}%` }"
              />
            </div>
          </div>
        </div>
      </div>
    </SettingsSection>

    <NoticeBanner v-if="specsError" tone="destructive">
      Could not read system information: {{ specsError }}
    </NoticeBanner>
    <div
      v-else-if="!specs"
      class="text-muted-foreground flex items-center gap-2 px-1 text-xs"
    >
      <Loader2 class="h-3.5 w-3.5 animate-spin" />
      Reading system information…
    </div>

    <template v-if="specs">
      <!-- Operating system -->
      <SettingsSection title="Operating system" icon-class="text-sky-400">
        <template #icon>
          <Monitor class="h-3.5 w-3.5" />
        </template>
        <SystemSpecList :rows="osRows" />
      </SettingsSection>

      <!-- Processor -->
      <SettingsSection title="Processor" icon-class="text-cyan-400">
        <template #icon>
          <Cpu class="h-3.5 w-3.5" />
        </template>
        <SystemSpecList :rows="cpuRows" />
      </SettingsSection>

      <!-- Memory -->
      <SettingsSection title="Memory" icon-class="text-violet-400">
        <template #icon>
          <MemoryStick class="h-3.5 w-3.5" />
        </template>
        <SystemSpecList :rows="memoryRows" />
      </SettingsSection>

      <!-- Graphics -->
      <SettingsSection title="Graphics" icon-class="text-emerald-400">
        <template #icon>
          <Gpu class="h-3.5 w-3.5" />
        </template>
        <p v-if="gpuCards.length === 0" class="text-muted-foreground text-xs">
          No graphics adapters were detected.
        </p>
        <div
          v-for="gpu in gpuCards"
          :key="gpu.name"
          class="border-border/60 bg-muted/20 flex flex-col gap-2.5 rounded-lg border p-3"
        >
          <h3 class="text-foreground text-xs font-semibold">{{ gpu.name }}</h3>
          <SystemSpecList :rows="gpu.rows" />
        </div>
        <p v-if="!hasLiveGpu" class="text-muted-foreground text-xs">
          Live GPU load, VRAM use and temperature need an NVIDIA GPU with its
          driver installed.
        </p>
      </SettingsSection>

      <!-- Storage -->
      <SettingsSection title="Storage" icon-class="text-amber-400">
        <template #icon>
          <HardDrive class="h-3.5 w-3.5" />
        </template>
        <div
          v-for="disk in disks"
          :key="disk.key"
          class="flex flex-col gap-1.5"
        >
          <div class="flex items-baseline justify-between gap-3 text-xs">
            <span class="text-foreground min-w-0 truncate font-medium">
              {{ disk.title }}
              <span
                v-if="disk.details"
                class="text-muted-foreground font-normal"
              >
                · {{ disk.details }}
              </span>
            </span>
            <span class="text-muted-foreground shrink-0">
              {{ disk.summary }}
              <span v-if="disk.lowSpace" class="text-amber-300">
                · low space
              </span>
            </span>
          </div>
          <div
            class="bg-primary/15 h-1.5 overflow-hidden rounded-full"
            role="meter"
            :aria-valuenow="Math.round(disk.usedPercent)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${disk.title} used space`"
          >
            <div
              class="h-full rounded-full"
              :class="disk.lowSpace ? 'bg-amber-400' : 'bg-primary'"
              :style="{ width: `${disk.usedPercent}%` }"
            />
          </div>
        </div>
      </SettingsSection>
    </template>

    <!-- ComfyUI runtime -->
    <SettingsSection
      v-if="runtimeRows.length > 0"
      title="ComfyUI runtime"
      description="Reported by the running ComfyUI server."
      icon-class="text-orange-400"
    >
      <template #icon>
        <Boxes class="h-3.5 w-3.5" />
      </template>
      <SystemSpecList :rows="runtimeRows" />
    </SettingsSection>
  </div>
</template>
