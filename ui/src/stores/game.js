import { writable } from 'svelte/store';

export const state = writable('waiting');
export const credits = writable(0);
export const score = writable(0);
export const records = writable([850, 720, 500]);
export const newRecord = writable(false);
