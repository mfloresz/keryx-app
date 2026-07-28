/**
 * Router Configuration
 */
import { createWebHistory, createRouter } from "vue-router";
import { getAuthAdapter } from "@/services/runtime";

const routes = [
  {
    path: "/",
    component: () => import("@/pages/index.vue"),
  },
  {
    path: "/chat/:id",
    component: () => import("@/pages/chat/[id].vue"),
  },
  {
    path: "/favorites",
    component: () => import("@/pages/favorites.vue"),
  },
  {
    path: "/login",
    component: () => import("@/pages/login.vue"),
    meta: { public: true, layout: false },
  },
  {
    path: "/invite/:token",
    component: () => import("@/pages/invite/[token].vue"),
    meta: { public: true, layout: false },
  },
  {
    path: "/admin",
    component: () => import("@/pages/admin/index.vue"),
    meta: { requiresAdmin: true },
  },
  {
    path: "/admin/invitations",
    redirect: "/admin",
    meta: { requiresAdmin: true },
  },
  {
    path: "/admin/users",
    redirect: "/admin",
    meta: { requiresAdmin: true },
  },
  {
    path: "/admin/models",
    redirect: "/admin",
    meta: { requiresAdmin: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = await getAuthAdapter();
  const session = await auth.getSession();

  if (session && to.path === "/login") {
    return "/";
  }

  if (session && to.path.startsWith("/invite/")) {
    return "/";
  }

  if (!session && to.meta.public !== true) {
    return "/login";
  }

  if (to.meta.requiresAdmin) {
    const response = await fetch("/api/auth/me", {
      headers: await auth.getAuthorizationHeaders(),
    });
    if (!response.ok) return "/";
    const payload = await response.json();
    if (payload.role !== "admin") return "/";
  }

  return true;
});

export default router;
