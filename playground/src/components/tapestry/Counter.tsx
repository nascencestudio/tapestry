import './Counter.css';
import { useState } from 'preact/hooks';

interface Props {
	label: string;
	initial?: number;
}

/** A Preact island (see tapestry.config.mjs: `client: 'visible'`). Server-rendered first, then interactive. */
export default function Counter({ label, initial = 0 }: Props) {
	const [count, setCount] = useState(initial);
	return (
		<div class="counter">
			<span class="counter__label">{label}</span>
			<button
				type="button"
				class="counter__button"
				aria-label={`${label}: decrease`}
				onClick={() => setCount((n) => n - 1)}
			>
				−
			</button>
			<output class="counter__value" aria-live="polite">
				{count}
			</output>
			<button
				type="button"
				class="counter__button"
				aria-label={`${label}: increase`}
				onClick={() => setCount((n) => n + 1)}
			>
				+
			</button>
		</div>
	);
}
