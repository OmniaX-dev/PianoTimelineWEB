// ------------------------------------------------------------
// NoteEvent class (1:1 with your GDScript version)
// ------------------------------------------------------------
class NoteEvent {
	constructor() {
		this.pitch = 0;
		this.start_time = 0.0;
		this.end_time = 0.0;
		this.duration = 0.0;
		this.velocity = 0;
		this.channel = 0;

		this.hit = false;
		this.right_hand = false;
		this.last = false;
		this.first = false;
		this.id = 0;
		this.progress = 0;
	}

	infoToString() {
		return (
			"NoteEvent {\n" +
			"  id: " +
			this.id +
			"\n" +
			"  pitch: " +
			this.pitch +
			"\n" +
			"  start_time: " +
			this.start_time +
			"\n" +
			"  end_time: " +
			this.end_time +
			"\n" +
			"  duration: " +
			this.duration +
			"\n" +
			"  velocity: " +
			this.velocity +
			"\n" +
			"  channel: " +
			this.channel +
			"\n" +
			"  hit: " +
			this.hit +
			"\n" +
			"  right_hand: " +
			this.right_hand +
			"\n" +
			"  first: " +
			this.first +
			"\n" +
			"  last: " +
			this.last +
			"\n" +
			"  progress: " +
			this.progress +
			"\n" +
			"}\n"
		);
	}
}

// ------------------------------------------------------------
// Tempo segment helper
// ------------------------------------------------------------
class TempoSegment {
	constructor(start_tick, us_per_quarter, base_seconds) {
		this.start_tick = start_tick;
		this.us_per_quarter = us_per_quarter;
		this.base_seconds = base_seconds;
	}
}

// ------------------------------------------------------------
// MIDI Parser
// ------------------------------------------------------------
class MidiParser {
	static async parseFile(path) {
		try {
			const response = await fetch(path);
			if (!response.ok) {
				console.error(`Failed to load MIDI file: ${path}`);
				return [];
			}

			const buffer = await response.arrayBuffer();
			const bytes = new Uint8Array(buffer);

			return this.parseBytes(bytes);
		} catch (err) {
			console.error("Error loading MIDI file:", err);
			return [];
		}
	}

	// -----------------------------
	// Low-level helpers
	// -----------------------------
	static readVLQ(data, pos) {
		let value = 0;
		let i = pos;

		while (true) {
			const b = data[i];
			value = (value << 7) | (b & 0x7f);
			i++;
			if ((b & 0x80) === 0) break;
		}

		return { value, next: i };
	}

	static readU16BE(data, offset) {
		return (data[offset] << 8) | data[offset + 1];
	}

	static readU32BE(data, offset) {
		return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
	}

	// -----------------------------
	// Tempo helpers
	// -----------------------------
	static buildTempoSegments(tpq, tempoEvents) {
		const segments = [];

		if (tempoEvents.length === 0) {
			segments.push(new TempoSegment(0, 500000, 0.0));
			return segments;
		}

		const first = tempoEvents[0];
		if (first.tick > 0) {
			segments.push(new TempoSegment(0, 500000, 0.0));
		}

		let current_us = 500000;
		let current_base_seconds = 0.0;
		let current_tick = 0;

		for (const ev of tempoEvents) {
			const t_tick = ev.tick;

			if (t_tick > current_tick) {
				const delta = t_tick - current_tick;
				const seconds = (delta * current_us) / (1_000_000 * tpq);
				current_base_seconds += seconds;
				current_tick = t_tick;
			}

			current_us = ev.us_per_quarter;
			segments.push(new TempoSegment(current_tick, current_us, current_base_seconds));
		}

		return segments;
	}

	static ticksToSeconds(tick, tpq, segments) {
		let seg = segments[0];

		for (const s of segments) {
			if (s.start_tick <= tick) seg = s;
			else break;
		}

		const delta = tick - seg.start_tick;
		const dt = (delta * seg.us_per_quarter) / (1_000_000 * tpq);
		return seg.base_seconds + dt;
	}

	// -----------------------------
	// Main parser
	// -----------------------------
	static parseBytes(data) {
		if (data.length < 14) {
			console.error("Invalid MIDI file: too small");
			return [];
		}

		// Header
		if (String.fromCharCode(...data.slice(0, 4)) !== "MThd") {
			console.error("Invalid MIDI file: missing MThd");
			return [];
		}

		const header_len = this.readU32BE(data, 4);
		const format = this.readU16BE(data, 8);
		const n_tracks = this.readU16BE(data, 10);
		const division = this.readU16BE(data, 12);

		if (division & 0x8000) {
			console.error("SMPTE division not supported");
			return [];
		}

		const tpq = division;

		if (n_tracks !== 1) {
			console.error(`Expected exactly 1 track, found ${n_tracks}`);
			return [];
		}

		let pos = 8 + header_len;

		if (String.fromCharCode(...data.slice(pos, pos + 4)) !== "MTrk") {
			console.error("Invalid MIDI file: missing MTrk");
			return [];
		}

		const track_len = this.readU32BE(data, pos + 4);
		const track_end = pos + 8 + track_len;
		let i = pos + 8;

		let abs_tick = 0;
		let running_status = -1;

		const note_events = [];
		const tempo_events = [{ tick: 0, us_per_quarter: 500000 }];

		// -----------------------------
		// Track parsing
		// -----------------------------
		while (i < track_end) {
			const vlq = this.readVLQ(data, i);
			abs_tick += vlq.value;
			i = vlq.next;

			if (i >= track_end) break;

			let status = data[i];

			if (status < 0x80) {
				if (running_status < 0) {
					console.error("Invalid running status");
					return [];
				}
				status = running_status;
			} else {
				i++;
				running_status = status;
			}

			if (status === 0xff) {
				const meta_type = data[i++];
				const len_vlq = this.readVLQ(data, i);
				const meta_len = len_vlq.value;
				i = len_vlq.next;

				if (meta_type === 0x51 && meta_len === 3) {
					const us = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
					tempo_events.push({ tick: abs_tick, us_per_quarter: us });
				}

				i += meta_len;
				running_status = -1;
			} else if (status === 0xf0 || status === 0xf7) {
				const syx = this.readVLQ(data, i);
				i = syx.next + syx.value;
				running_status = -1;
			} else {
				const event_type = status & 0xf0;
				const channel = status & 0x0f;

				if (event_type === 0x80 || event_type === 0x90) {
					const pitch = data[i];
					const velocity = data[i + 1];
					i += 2;

					const is_on = event_type === 0x90 && velocity > 0;

					note_events.push({
						tick: abs_tick,
						channel,
						pitch,
						velocity,
						is_on,
					});
				} else {
					const size = event_type === 0xc0 || event_type === 0xd0 ? 1 : 2;
					i += size;
				}
			}
		}

		// -----------------------------
		// Tempo map
		// -----------------------------
		tempo_events.sort((a, b) => a.tick - b.tick);
		const segments = this.buildTempoSegments(tpq, tempo_events);

		for (const ev of note_events) {
			ev.seconds = this.ticksToSeconds(ev.tick, tpq, segments);
		}

		// -----------------------------
		// Pair note on/off
		// -----------------------------
		const stacks = {};
		const notes = [];

		for (const ev of note_events) {
			const key = (ev.channel << 8) | ev.pitch;

			if (ev.is_on) {
				if (!stacks[key]) stacks[key] = [];
				stacks[key].push(ev);
			} else {
				if (stacks[key] && stacks[key].length > 0) {
					const on_ev = stacks[key].pop();
					const note = new NoteEvent();

					note.pitch = on_ev.pitch;
					note.start_time = on_ev.seconds;
					note.end_time = ev.seconds;
					note.duration = note.end_time - note.start_time;
					note.velocity = on_ev.velocity;
					note.channel = on_ev.channel;

					notes.push(note);
				}
			}
		}

		// -----------------------------
		// Mark first/last
		// -----------------------------
		if (notes.length > 0) {
			let first = notes[0];
			let last = notes[0];

			let id = 0;
			for (const n of notes) {
				n.id = id++;
				if (n.start_time < first.start_time) first = n;
				if (n.end_time > last.end_time) last = n;
			}

			first.first = true;
			last.last = true;
		}

		notes.sort((a, b) => {
			if (a.start_time === b.start_time) return a.pitch - b.pitch;
			return a.start_time - b.start_time;
		});

		return notes;
	}
}
