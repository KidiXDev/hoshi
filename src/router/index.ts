import { createRouter, createWebHistory } from 'vue-router';
import AnimadexExploreView from '../views/AnimadexExploreView.vue';
import BooruGalleryView from '../views/BooruGalleryView.vue';
import CivitaiBrowserView from '../views/CivitaiBrowserView.vue';
import CivitaiModelDetailView from '../views/CivitaiModelDetailView.vue';
import FaceDetailerView from '../views/FaceDetailerView.vue';
import ImageViewerView from '../views/ImageViewerView.vue';
import RemoveBackgroundView from '../views/RemoveBackgroundView.vue';
import ServerTerminalView from '../views/ServerTerminalView.vue';
import SettingsView from '../views/SettingsView.vue';
import UpscalerView from '../views/UpscalerView.vue';
import WorkflowGeneratorView from '../views/WorkflowGeneratorView.vue';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/comfyui',
      name: 'comfyui',
      // The editor is mounted persistently by App.vue to preserve its iframe.
      component: { render: () => null }
    },
    {
      path: '/danbooru-wiki/:title?',
      name: 'danbooru-wiki',
      component: () => import('../views/DanbooruWikiView.vue')
    },
    {
      path: '/',
      redirect: '/workflow'
    },
    {
      path: '/workflow',
      name: 'workflow',
      component: WorkflowGeneratorView
    },
    {
      path: '/viewer',
      name: 'viewer',
      component: ImageViewerView
    },
    {
      path: '/booru',
      name: 'booru',
      component: BooruGalleryView
    },
    {
      path: '/animadex',
      name: 'animadex',
      component: AnimadexExploreView
    },
    {
      path: '/civitai',
      name: 'civitai',
      component: CivitaiBrowserView
    },
    {
      path: '/civitai/model/:id',
      name: 'civitai-model-detail',
      component: CivitaiModelDetailView,
      props: true
    },
    {
      path: '/upscaler',
      name: 'upscaler',
      component: UpscalerView
    },
    {
      path: '/remove-background',
      name: 'remove-background',
      component: RemoveBackgroundView
    },
    {
      path: '/face-detailer',
      name: 'face-detailer',
      component: FaceDetailerView
    },
    {
      path: '/server',
      name: 'server',
      component: ServerTerminalView
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView
    },
    {
      path: '/library',
      name: 'library',
      component: () => import('../views/LibraryView.vue')
    },
    {
      path: '/models',
      name: 'models',
      component: () => import('../views/ModelManagerView.vue')
    },
    {
      path: '/models/:id',
      name: 'model-detail',
      component: () => import('../views/ModelManagerDetailView.vue'),
      props: true
    }
  ]
});

export default router;
