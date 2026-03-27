//
// Utility Color class (simple RGBA container)
//
class Color {
	constructor(r = 0, g = 0, b = 0, a = 1.0) {
		this.r = r;
		this.g = g;
		this.b = b;
		this.a = a;
	}

	static from8(r, g, b, a = 255) {
		return new Color(r / 255, g / 255, b / 255, a / 255);
	}

	static get TRANSPARENT() {
		return new Color(0, 0, 0, 0);
	}
}

//
// -----------------------------------------------------------------------------
// PianoKey (1:1 port)
// -----------------------------------------------------------------------------
class PianoKey {
	constructor() {
		this.note_info = null; // You will assign your JS NoteInfo equivalent
		this.pressed = false;
	}
}

//
// -----------------------------------------------------------------------------
// VirtualPianoData (1:1 port)
// -----------------------------------------------------------------------------
class VirtualPianoData {
	constructor() {
		// Constants
		this.BASE_WIDTH = 2080;
		this.BASE_HEIGHT = 1600;

		// Internal state
		this.pixels_per_second = 0.0;
		this.virtual_piano_x = 0.0;
		this.virtual_piano_y = 0.0;
		this.white_key_width = 0.0;
		this.white_key_height = 0.0;
		this.black_key_width = 0.0;
		this.black_key_height = 0.0;
		this.black_key_offset = 0.0;
		this.scale_x = 1.0;
		this.scale_y = 1.0;
		this.white_key_shrink_factor = 0.0;
		this.black_key_shrink_factor = 0.0;
		this._key_offsets = {}; // keyIndex → x position

		// Public fields
		this.falling_time_s = 0.0;
		this.use_filled_notes = true;

		// Colors
		this.background_color = null;
		this.white_key_color = null;
		this.white_key_pressed_color = null;
		this.white_key_split_color = null;
		this.black_key_color = null;
		this.black_key_pressed_color = null;
		this.falling_white_note_color = null;
		this.falling_black_note_color = null;
		this.piano_line_color = null;

		// Initialize defaults
		this._init();
	}

	//
	// Initialization (matches GDScript)
	//
	_init() {
		this.falling_time_s = 4.5;

		this.white_key_width = 40;
		this.white_key_height = this.white_key_width * 8;
		this.black_key_width = 22;
		this.black_key_height = this.black_key_width * 9;
		this.black_key_offset = 4;

		this.white_key_color = Color.from8(230, 230, 230);
		this.white_key_pressed_color = Color.from8(150, 150, 150);
		this.white_key_split_color = Color.from8(0, 0, 0);

		this.black_key_color = Color.from8(0, 0, 0);
		this.black_key_pressed_color = Color.from8(80, 80, 80);

		this.virtual_piano_x = 0.0;
		this.pixels_per_second = 280;
		this.virtual_piano_y = this.BASE_HEIGHT - this.white_key_height;

		this.scale_x = 1.0;
		this.scale_y = 1.0;

		this.falling_white_note_color = Color.from8(0, 180, 30);
		this.falling_black_note_color = Color.from8(0, 80, 20);

		this.piano_line_color = Color.from8(180, 10, 10);

		this.background_color = Color.from8(8, 8, 8);

		this.white_key_shrink_factor = 8;
		this.black_key_shrink_factor = 0;

		this.recalc_key_offsets();
	}

	//
	// Scaling
	//
	update_scale(width, height) {
		this.scale_x = width / this.BASE_WIDTH;
		this.scale_y = height / this.BASE_HEIGHT;
		this.recalc_key_offsets();
	}

	//
	// Accessors (1:1 with GDScript)
	//
	pps() {
		return this.pixels_per_second * this.scale_y;
	}
	vpx() {
		return this.virtual_piano_x * this.scale_x;
	}
	vpy() {
		return this.virtual_piano_y * this.scale_y;
	}

	white_key_w() {
		return this.white_key_width * this.scale_x;
	}
	white_key_h() {
		return this.white_key_height * this.scale_y;
	}

	black_key_w() {
		return this.black_key_width * this.scale_x;
	}
	black_key_h() {
		return this.black_key_height * this.scale_y;
	}

	black_key_off() {
		return this.black_key_offset * this.scale_x;
	}

	white_key_shrink() {
		return this.white_key_shrink_factor * this.scale_x;
	}
	black_key_shrink() {
		return this.black_key_shrink_factor * this.scale_x;
	}

	key_offsets() {
		this.recalc_key_offsets();
		return this._key_offsets;
	}

	//
	// Recalculate key positions (1:1 logic)
	//
	recalc_key_offsets() {
		this._key_offsets = {};
		let white_count = 0;

		for (let midi_note = 21; midi_note < 109; midi_note++) {
			const note_in_octave = midi_note % 12;
			const key_index = midi_note - 21;

			if (VirtualPianoData.is_white_key(note_in_octave)) {
				const x = this.vpx() + white_count * this.white_key_w();
				this._key_offsets[key_index] = x;
				white_count++;
			} else {
				const x =
					this.vpx() +
					((white_count - 1) * this.white_key_w() +
						(this.white_key_w() - this.black_key_w() / 2)) -
					this.black_key_off();

				this._key_offsets[key_index] = x;
			}
		}
	}

	static get_note_info(midi_pitch) {
		const names = [
			"C",
			"C#",
			"D",
			"D#",
			"E",
			"F",
			"F#",
			"G",
			"G#",
			"A",
			"A#",
			"B",
		];
		const info = new NoteInfo();

		info.note_in_octave = midi_pitch % 12;
		info.name = names[info.note_in_octave];
		info.octave = Math.floor(midi_pitch / 12) - 1;

		if (midi_pitch >= 21 && midi_pitch <= 108) info.key_index = midi_pitch - 21;
		else info.key_index = -1;

		return info;
	}

	static is_white_key(note_in_octave) {
		return [0, 2, 4, 5, 7, 9, 11].includes(note_in_octave);
	}
}
