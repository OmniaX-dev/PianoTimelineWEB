function formatDuration(seconds) {
	const total = Math.floor(seconds);
	const mins = Math.floor(total / 60);
	const secs = total % 60;
	return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

class FallingNoteGfxData {
	constructor() {
		this.rect = { x: 0, y: 0, w: 0, h: 0 }; // Rect2 equivalent
		this.fill_color = null; // Color
		this.corner_radius = 0.0;
		this.id = 0;
	}
}

class MidiVisualizer {
	constructor(vpd, vpk, midi_notes) {
		this.first_note_start_time_s = 0.0;
		// Data
		this.vpd = vpd; // VirtualPianoData
		this.vpk = vpk; // VirtualKeyboard
		this.midi_notes = midi_notes; // Array<NoteEvent>
		for (const note of midi_notes) {
			note.start_time += vpd.falling_time_s;
			note.end_time += vpd.falling_time_s;

			if (note.first) this.first_note_start_time_s = note.start_time;
		}

		// Falling notes
		this.active_falling_notes = []; // Array<NoteEvent>
		this.next_falling_note_index = 0;
		this.white_notes_gfx_data = {}; // id -> FallingNoteGfxData
		this.black_notes_gfx_data = {}; // id -> FallingNoteGfxData

		// Playback data
		this.start_time_ms = performance.now();
		this.audio_start_ms = 0.0;
		this.first_note_played = false;
		this.audioStart_s = 0.0;
		this.audioPlayer = null;

		// "Signals" as listener arrays
		this.note_on_listeners = [];
		this.note_off_listeners = [];
		this.midi_start_listeners = [];
		this.sound_start_listeners = [];
		this.onNoteOn((note) => this.on_note_on(note));
		this.onNoteOff((note) => this.on_note_off(note));
		this.onMidiStart((note) => this.on_midi_start(note));
		this.onSoundStart(() => this.on_sound_start());
		this.on_sound_finish = this.on_sound_finish.bind(this);

		this.stopped = false;
		this.sound_started = false;
		this.sound_finished = false;
	}
	clearAllListeners() {
		this.note_on_listeners.length = 0;
		this.note_off_listeners.length = 0;
		this.midi_start_listeners.length = 0;
		this.sound_start_listeners.length = 0;
		if (this.audioPlayer) this.audioPlayer.removeEventListener("ended", this.on_sound_finish);
	}
	stop() {
		this.clearAllListeners();
		this.stopped = true;
	}
	onNoteOn(cb) {
		this.note_on_listeners.push(cb);
	}
	onNoteOff(cb) {
		this.note_off_listeners.push(cb);
	}
	onMidiStart(cb) {
		this.midi_start_listeners.push(cb);
	}
	onSoundStart(cb) {
		this.sound_start_listeners.push(cb);
	}
	_emit_note_on(note) {
		for (const cb of this.note_on_listeners) cb(note);
	}
	_emit_note_off(note) {
		for (const cb of this.note_off_listeners) cb(note);
	}
	_emit_midi_start(note) {
		for (const cb of this.midi_start_listeners) cb(note);
	}
	_emit_sound_start() {
		for (const cb of this.sound_start_listeners) cb();
	}
	set_audio_player(audioPlayer, soundStart) {
		this.audioPlayer = audioPlayer;
		this.audioStart_s = soundStart;

		this.audioPlayer.addEventListener("ended", this.on_sound_finish);

		if (this.audioStart_s > this.first_note_start_time_s) {
			const offset = this.audioStart_s - this.first_note_start_time_s;

			for (const note of this.midi_notes) {
				note.start_time += offset;
				note.end_time += offset;
				if (note.first) this.first_note_start_time_s = note.start_time;
			}
		}
	}
	get_play_time_s() {
		const play_time_ms = performance.now() - this.start_time_ms;
		return play_time_ms * 1e-3;
	}
	get_audio_time_s() {
		const audio_time_ms = performance.now() - this.audio_start_ms;
		return audio_time_ms * 1e-3;
	}
	update_duration_span() {
		const durationSpan = document.querySelectorAll("div#visualizer-duration > span.visualizer-duration-elapsed")[0];
		if (!this.sound_started || this.sound_finished) durationSpan.textContent = "00:00";
		else durationSpan.textContent = formatDuration(this.get_audio_time_s());
	}
	update_visualization(current_time = this.get_play_time_s()) {
		this.update_duration_span();
		if (!this.sound_started && current_time >= this.first_note_start_time_s - this.audioStart_s) {
			this._emit_sound_start();
			this.sound_started = true;
		}
		// --- Remove notes that have ended ---
		while (this.active_falling_notes.length > 0 && current_time > this.active_falling_notes[0].end_time + 0.05) {
			const note = this.active_falling_notes[0];
			const info = VirtualPianoData.get_note_info(note.pitch);

			// Reset key state
			this.vpk.piano_keys[info.key_index].pressed = false;

			// Remove from front
			this.active_falling_notes.shift();
		}

		// --- Add new notes that should start falling now ---
		while (this.next_falling_note_index < this.midi_notes.length && current_time >= this.midi_notes[this.next_falling_note_index].start_time - this.vpd.falling_time_s - 1.0) {
			const note = this.midi_notes[this.next_falling_note_index];
			this.active_falling_notes.push(note);
			this.spawn_note_node(note);
			this.next_falling_note_index++;
		}

		// --- Update positions, pressed states, etc. ---
		this.calculate_falling_notes(current_time);
	}
	calculate_falling_notes(current_time) {
		const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

		// White keys first
		for (const note of this.active_falling_notes) {
			const info = VirtualPianoData.get_note_info(note.pitch);
			if (!info.is_white_key()) continue;

			const h = note.duration * this.vpd.pps();
			const total_travel_time = this.vpd.falling_time_s + note.duration;
			const elapsed_since_spawn = current_time - (note.start_time - this.vpd.falling_time_s);

			note.progress = elapsed_since_spawn / total_travel_time;
			note.progress = clamp(note.progress, 0.0, 1.0);

			const y = -h + note.progress * (this.vpd.vpy() + h);
			const x = this.vpd.key_offsets()[info.key_index] + this.vpd.white_key_shrink() / 2.0;

			const gfx = this.white_notes_gfx_data[note.id];
			if (gfx) {
				gfx.rect.x = x;
				gfx.rect.y = y;
			}

			if (y >= this.vpd.vpy()) {
				this.vpk.piano_keys[info.key_index].pressed = false;
				this._emit_note_off(note);
			} else if (y + h >= this.vpd.vpy()) {
				this.vpk.piano_keys[info.key_index].pressed = true;
				this._emit_note_on(note);
				if (!this.first_note_played) {
					this._emit_midi_start(note);
					this.first_note_played = true;
				}
			}
		}

		// Then black keys
		for (const note of this.active_falling_notes) {
			const info = VirtualPianoData.get_note_info(note.pitch);
			if (info.is_white_key()) continue;

			const h = note.duration * this.vpd.pps();
			const total_travel_time = this.vpd.falling_time_s + note.duration;
			const elapsed_since_spawn = current_time - (note.start_time - this.vpd.falling_time_s);

			note.progress = elapsed_since_spawn / total_travel_time;
			note.progress = clamp(note.progress, 0.0, 1.0);

			const y = -h + note.progress * (this.vpd.vpy() + h);
			const x = this.vpd.key_offsets()[info.key_index] + this.vpd.black_key_shrink() / 2.0;

			const gfx = this.black_notes_gfx_data[note.id];
			if (gfx) {
				gfx.rect.x = x;
				gfx.rect.y = y;
			}

			if (y >= this.vpd.vpy()) {
				this.vpk.piano_keys[info.key_index].pressed = false;
				this._emit_note_off(note);
			} else if (y + h >= this.vpd.vpy()) {
				this.vpk.piano_keys[info.key_index].pressed = true;
				this._emit_note_on(note);
				if (!this.first_note_played) {
					this._emit_midi_start(note);
					this.first_note_played = true;
				}
			}
		}
	}
	build_note_gfx_data(noteEvent) {
		const info = VirtualPianoData.get_note_info(noteEvent.pitch);
		const h = noteEvent.duration * this.vpd.pps();
		const y = -h + noteEvent.progress * (this.vpd.vpy() + h);
		const x = this.vpd.key_offsets()[info.key_index] + this.vpd.white_key_shrink() / 2.0;

		const gfx = new FallingNoteGfxData();
		gfx.id = noteEvent.id;
		gfx.rect.y = y;
		gfx.rect.h = h;

		if (!info.is_white_key()) {
			const note_color = this.vpd.falling_black_note_color; // matches your GDScript
			gfx.rect.x = x;
			gfx.rect.w = this.vpd.black_key_w() - this.vpd.black_key_shrink();
			gfx.fill_color = note_color;
			gfx.corner_radius = 5;
		} else {
			const note_color = this.vpd.falling_white_note_color;
			gfx.rect.x = x;
			gfx.rect.w = this.vpd.white_key_w() - this.vpd.white_key_shrink();
			gfx.fill_color = note_color;
			gfx.corner_radius = 10;
		}

		return gfx;
	}
	spawn_note_node(note) {
		const info = VirtualPianoData.get_note_info(note.pitch);
		const note_gfx = this.build_note_gfx_data(note);

		if (info.is_white_key()) {
			this.white_notes_gfx_data[note.id] = note_gfx;
		} else {
			this.black_notes_gfx_data[note.id] = note_gfx;
		}
	}
	on_note_off(note) {
		const info = VirtualPianoData.get_note_info(note.pitch);
		this.vpk.piano_keys[info.key_index].pressed = false;

		if (info.is_white_key()) {
			delete this.white_notes_gfx_data[note.id];
		} else {
			delete this.black_notes_gfx_data[note.id];
		}
	}
	on_note_on(note) {
		//
	}
	on_midi_start(note) {
		//
	}
	on_sound_start() {
		if (!this.audioPlayer) return;
		this.audioPlayer.currentTime = 0;
		this.audioPlayer.play();
		this.audio_start_ms = performance.now();
	}
	on_sound_finish() {
		this.sound_finished = true;
	}
	draw(ctx, canvasWidth, canvasHeight) {
		// Draw falling notes on top
		this.render_falling_notes(ctx);
		// Draw keyboard
		this.vpk.render(ctx, this.vpd, canvasWidth, canvasHeight);

		this.vpk.drawVignette(ctx, canvasWidth, canvasHeight, {
			topHeight: 0.03,
			bottomHeight: 0.1,
			topSoftness: 0.00000001,
			bottomSoftness: 0.001,
			intensity: 1.0,
		});
	}
	render_falling_notes(ctx) {
		// White notes
		for (const id in this.white_notes_gfx_data) {
			const gfx = this.white_notes_gfx_data[id];
			const c = gfx.fill_color;
			this.vpk.fill_rounded_rect(ctx, gfx.rect.x, gfx.rect.y, gfx.rect.w, gfx.rect.h, c, gfx.corner_radius, gfx.corner_radius, gfx.corner_radius, gfx.corner_radius);
		}

		// Black notes
		for (const id in this.black_notes_gfx_data) {
			const gfx = this.black_notes_gfx_data[id];
			const c = gfx.fill_color;
			this.vpk.fill_rounded_rect(ctx, gfx.rect.x, gfx.rect.y, gfx.rect.w, gfx.rect.h, c, gfx.corner_radius, gfx.corner_radius, gfx.corner_radius, gfx.corner_radius);
		}
	}
}

// ------------------------------------------------------------
// Main Loop
// ------------------------------------------------------------
const canvas = document.getElementById("pianoCanvas");
const audioPlayer = document.querySelectorAll("audio.top-player")[0];
const volume_slider = document.querySelector("#visualizer-volume > input.volume-slider");
const ctx = canvas.getContext("2d");

async function loadRecording(jsonRecord) {
	const vpd = new VirtualPianoData();
	const keyboard = new VirtualKeyboard();
	keyboard.initialize();
	const midiPath = "music/" + jsonRecord["midi-file-name"];
	const audioPath = "music/" + jsonRecord["file-name"];
	const audioStart = jsonRecord["sound-start"];

	volume_slider.value = audioPlayer.volume;

	const titleLabel = document.getElementById("visualizer-info");
	titleLabel.innerHTML =
		'<span class="visualizer-info-title">' +
		jsonRecord["title"] +
		'</span> <span class="visualizer-info-separator">|</span> <span class="visualizer-info-artist">' +
		jsonRecord["artist"] +
		'</span> <span class="visualizer-info-separator">|</span> <span class="visualizer-info-performances">(performance ' +
		jsonRecord["performance-number"] +
		"/" +
		jsonRecord["total-performances"] +
		')</span> <span class="visualizer-info-separator">|</span> <span class="visualizer-info-date">' +
		jsonRecord["date"] +
		"</span>";
	const durationSpan = document.querySelectorAll("div#visualizer-duration > span.visualizer-duration-total")[0];
	durationSpan.textContent = formatDuration(jsonRecord["duration"]);

	const notes = await MidiParser.parseFile(encodeURIComponent(midiPath));
	const visualizer = new MidiVisualizer(vpd, keyboard, notes);
	visualizer.set_audio_player(audioPlayer, audioStart);
	audioPlayer.src = encodeURIComponent(audioPath);

	function resizeCanvas() {
		const visualizer_wrapper = document.querySelectorAll(".visualizer-wrapper")[0];
		const margin = 50;
		canvas.width = window.innerWidth - margin * 2;
		canvas.height = window.innerHeight - margin * 2;
		const w = canvas.width + "px";
		visualizer_wrapper.style.width = canvas.width + "px";
		visualizer_wrapper.style.height = canvas.height + "px";
		vpd.update_scale(canvas.width, canvas.height);
	}

	window.addEventListener("resize", resizeCanvas);
	resizeCanvas();

	// Render loop
	function loop() {
		if (visualizer.stopped) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		ctx.fillStyle = keyboard._color_to_css(vpd.background_color);
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		visualizer.update_visualization();
		visualizer.draw(ctx, canvas.width, canvas.height);

		requestAnimationFrame(loop);
	}

	loop();

	return visualizer;
}
