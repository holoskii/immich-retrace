import {mount} from 'svelte';
import App from './App.svelte';
import './app.css';

const target = document.getElementById('app')!;
// index.html's loading shell; mount() appends, so clear it in the same task (no empty frame).
target.replaceChildren();
mount(App, {target});
