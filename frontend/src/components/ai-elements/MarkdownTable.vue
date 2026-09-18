<script setup lang="ts">
/**
 * Replacement renderer for <table> elements in markdown.
 * Wraps the table in a horizontal scroll container so wide tables
 * (many columns, nowrap headers) don't get clipped by the
 * `overflow-hidden` message bubble and remain reachable on narrow screens.
 * `tabindex` makes the scroll region keyboard-operable.
 */
defineOptions({ inheritAttrs: false })
</script>

<template>
  <div class="markdown-table-wrapper" tabindex="0">
    <table v-bind="$attrs"><slot /></table>
  </div>
</template>
