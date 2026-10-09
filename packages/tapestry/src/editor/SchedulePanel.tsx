/**
 * Scheduled publishing: pick a date and time for the current version to go
 * live, or cancel a schedule. The time is entered in the editor's own time zone
 * and stored in UTC. Nothing changes for visitors until that time.
 */
import { useSignal } from '@preact/signals';
import type { Publishing } from './publishing.js';

interface Props {
	publishing: Publishing;
	/** Save the page after scheduling or cancelling (StudioCMS's form submit). */
	onSchedule: (at: string) => void;
	onCancel: () => void;
	onClose: () => void;
	disabled: boolean;
}

/** `YYYY-MM-DDTHH:mm` in local time, as `<input type="datetime-local">` expects. */
export function toLocalInput(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Readable local date and time for a stored ISO time. */
export function formatWhen(iso: string): string {
	return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function SchedulePanel({ publishing, onSchedule, onCancel, onClose, disabled }: Props) {
	const scheduled = publishing.stored.value.scheduled;
	const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
	inAnHour.setMinutes(0, 0, 0);
	const value = useSignal(toLocalInput(inAnHour));
	const error = useSignal('');
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	function submit() {
		const when = new Date(value.value);
		if (Number.isNaN(when.getTime())) {
			error.value = 'Choose a date and time.';
			return;
		}
		if (when.getTime() < Date.now() + 60_000) {
			error.value = 'Choose a time at least a minute from now.';
			return;
		}
		error.value = '';
		onSchedule(when.toISOString());
	}

	return (
		<section class="tp-panel tp-schedule" aria-labelledby="tp-schedule-heading" data-tapestry-schedule>
			<div class="tp-panel__header">
				<h3 id="tp-schedule-heading" class="tp-panel__title">
					Schedule publishing
				</h3>
				<button type="button" class="tp-link-button" onClick={onClose}>
					Close
				</button>
			</div>
			{scheduled && (
				<p class="tp-schedule__current" data-tapestry-scheduled-at={scheduled.at}>
					A version is scheduled to go live on <strong>{formatWhen(scheduled.at)}</strong>
					{scheduled.by ? ` (scheduled by ${scheduled.by})` : ''}. Later edits aren't part of it; schedule again to
					include them.{' '}
					<button
						type="button"
						class="tp-button tp-button--danger"
						disabled={disabled}
						onClick={onCancel}
						data-tapestry-schedule-cancel
					>
						Cancel schedule
					</button>
				</p>
			)}
			<div class="tp-schedule__form">
				<label class="tp-field__label" for="tp-schedule-at">
					{scheduled ? 'Reschedule the current version for' : 'Make the current version live on'}
				</label>
				{/* Detached from StudioCMS's page form (form= an id that doesn't exist): its constraints
				    (min, step) would otherwise make the browser silently block StudioCMS's Save. */}
				<input
					id="tp-schedule-at"
					form="tapestry-detached"
					class="tp-input"
					type="datetime-local"
					value={value.value}
					min={toLocalInput(new Date())}
					aria-describedby="tp-schedule-help"
					data-tapestry-schedule-input
					onInput={(e) => {
						value.value = e.currentTarget.value;
					}}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							submit();
						}
					}}
				/>
				<button
					type="button"
					class="tp-button tp-button--primary"
					disabled={disabled}
					onClick={submit}
					data-tapestry-schedule-submit
				>
					{scheduled ? 'Reschedule' : 'Schedule'}
				</button>
			</div>
			<p id="tp-schedule-help" class="tp-field__help">
				Time zone: {zone}. Visitors keep seeing the current published version until then; the history keeps the previous
				one.
			</p>
			{error.value && (
				<p class="tp-field__error" role="alert">
					{error.value}
				</p>
			)}
		</section>
	);
}
