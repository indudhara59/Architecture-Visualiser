import { render } from 'preact';
import { App } from './app';
import css from './styles.css';

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);

render(<App />, document.getElementById('app')!);
