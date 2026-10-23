import './styles/index.css';
import { bindInteractions } from './app/interactions';
import { renderLayout } from './app/layout';
import { render, renderSweepChart } from './app/render';
import { compute, computeDerived, computeSweep, schedule, startPeakSweep } from './app/scheduler';
import { paintSliders } from './app/sliders';

/**
 * Bootstrap. The app is organised as
 *   app/context     shared state + derived data
 *   app/store       input changes (pure rules + persistence)
 *   app/scheduler   analyses: fast static path, then waves / fishtail, sweeps, slider hints
 *   app/render      state + results → DOM, through the ui/ view functions
 *   app/interactions, app/animation   user events and the gust animation
 *   app/layout      page markup
 * and physics/ holds the calculation engine (no DOM).
 */
renderLayout(document.getElementById('app')!);
bindInteractions();
window.addEventListener('resize', () => schedule());

compute(true);
render();
computeSweep();
renderSweepChart();
computeDerived();
paintSliders();
startPeakSweep();
