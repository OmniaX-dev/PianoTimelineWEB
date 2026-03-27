class NoteInfo {
	constructor() {
		this.name = "";
		this.octave = 0;
		this.note_in_octave = 0;
		this.key_index = 0;
	}

	is_white_key() {
		return [0, 2, 4, 5, 7, 9, 11].includes(this.note_in_octave);
	}
}
class VirtualKeyboard {
	constructor() {
		this.piano_keys = [];
	}

	initialize() {
		let white_index = 0;

		for (let midi_note = 21; midi_note < 109; midi_note++) {
			const note_in_octave = midi_note % 12;
			const pk = new PianoKey();
			pk.note_info = VirtualPianoData.get_note_info(midi_note);
			pk.pressed = false;

			if (VirtualPianoData.is_white_key(note_in_octave)) white_index++;

			this.piano_keys.push(pk);
		}
	}

	draw_rect(ctx, x, y, w, h, color, filled = true) {
		ctx.fillStyle = ctx.strokeStyle = this._color_to_css(color);

		if (filled) {
			ctx.fillRect(x, y, w, h);
		} else {
			ctx.strokeRect(x, y, w, h);
		}
	}

	fill_rounded_rect(ctx, x, y, w, h, color, r_tl, r_tr, r_br, r_bl) {
		ctx.fillStyle = this._color_to_css(color);

		ctx.beginPath();
		ctx.moveTo(x + r_tl, y);

		ctx.lineTo(x + w - r_tr, y);
		ctx.quadraticCurveTo(x + w, y, x + w, y + r_tr);

		ctx.lineTo(x + w, y + h - r_br);
		ctx.quadraticCurveTo(x + w, y + h, x + w - r_br, y + h);

		ctx.lineTo(x + r_bl, y + h);
		ctx.quadraticCurveTo(x, y + h, x, y + h - r_bl);

		ctx.lineTo(x, y + r_tl);
		ctx.quadraticCurveTo(x, y, x + r_tl, y);

		ctx.fill();
	}

	drawVignette(
		ctx,
		width,
		height,
		{
			topHeight = 0.25,
			bottomHeight = 0.25,
			topSoftness = 0.2,
			bottomSoftness = 0.2,
			intensity = 1.0,
		} = {},
	) {
		ctx.save();

		// --- TOP GRADIENT ---
		const topGrad = ctx.createLinearGradient(0, 0, 0, height * topHeight);
		const startAlpha = 1 * intensity;
		const endAlpha = 0;
		const steps = 128;
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			const a = startAlpha + (endAlpha - startAlpha) * t;
			topGrad.addColorStop(t, `rgba(0,0,0,${a})`);
		}

		ctx.fillStyle = topGrad;
		ctx.fillRect(0, 0, width, height * topHeight);

		// --- BOTTOM GRADIENT ---
		const bottomGrad = ctx.createLinearGradient(
			0,
			height,
			0,
			height - height * bottomHeight,
		);
		bottomGrad.addColorStop(0, `rgba(0,0,0,${1 * intensity})`);
		bottomGrad.addColorStop(bottomSoftness, `rgba(0,0,0,${1 * intensity})`);
		bottomGrad.addColorStop(1, `rgba(0,0,0,0)`);

		ctx.fillStyle = bottomGrad;
		ctx.fillRect(
			0,
			height - height * bottomHeight,
			width,
			height * bottomHeight,
		);

		ctx.restore();
	}

	_color_to_css(c) {
		return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`;
	}

	render(ctx, vpd, canvasWidth, canvasHeight) {
		let white_index = 0;

		// --- Draw white keys ---
		for (let midi_note = 21; midi_note < 109; midi_note++) {
			const note_in_octave = midi_note % 12;

			if (VirtualPianoData.is_white_key(note_in_octave)) {
				const info = VirtualPianoData.get_note_info(midi_note);
				const x = vpd.vpx() + white_index * vpd.white_key_w();
				const y = vpd.vpy();

				let color = vpd.white_key_color;

				if (this.piano_keys[info.key_index].pressed) {
					color = vpd.white_key_pressed_color;
				}

				this.draw_rect(
					ctx,
					x,
					y,
					vpd.white_key_w(),
					vpd.white_key_h(),
					color,
					true,
				);
				this.draw_rect(
					ctx,
					x,
					y,
					vpd.white_key_w(),
					vpd.white_key_h(),
					vpd.white_key_split_color,
					false,
				);

				white_index++;
			}
		}

		// --- Piano line ---
		this.draw_rect(
			ctx,
			vpd.vpx(),
			vpd.vpy(),
			canvasWidth,
			4,
			vpd.piano_line_color,
			true,
		);

		// --- Draw black keys ---
		white_index = 0;

		for (let midi_note = 21; midi_note < 109; midi_note++) {
			const note_in_octave = midi_note % 12;

			if (VirtualPianoData.is_white_key(note_in_octave)) {
				white_index++;
			} else {
				const info = VirtualPianoData.get_note_info(midi_note);

				const x =
					vpd.vpx() +
					((white_index - 1) * vpd.white_key_w() +
						(vpd.white_key_w() - vpd.black_key_w() / 2)) -
					vpd.black_key_off();

				const y = vpd.vpy();

				let color = vpd.black_key_color;

				if (this.piano_keys[info.key_index].pressed) {
					color = vpd.black_key_pressed_color;
				}

				this.fill_rounded_rect(
					ctx,
					x,
					y,
					vpd.black_key_w(),
					vpd.black_key_h(),
					color,
					0,
					0,
					8,
					8,
				);
			}
		}
	}
}
