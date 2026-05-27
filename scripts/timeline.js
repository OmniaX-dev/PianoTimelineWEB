var sortedArtists = new Set();
var sortedYears = new Set();
var searchFilter = "";

var visualizer = null;

async function loadTimeline(firstTime = false) {
	const response = await fetch("music/list.json");
	const json = await response.json();
	const recordings = json.data;

	const timeline = document.querySelector(".timeline");
	let lastDate = null;

	const allArtists = new Set();
	const allYears = new Set();

	for (let index = 0; index < recordings.length; index++) {
		const isLast = index === recordings.length - 1;
		const r = recordings[index];

		if (firstTime) {
			if (r.artist) {
				if (r.artist.toLowerCase().trim().includes("soundtrack")) allArtists.add("Soundtracks");
				else allArtists.add(r.artist);
			}
			if (r.date) {
				allYears.add(getYearFromDate(r.date));
			}
		}

		if (!firstTime && !checkFilters(r)) continue;
		const formattedDate = formatDate(r.date);

		const left = document.createElement("div");
		left.className = "timeline-component";
		if (isLast) left.classList.add("timeline-component-bottom");

		const dateDiv = document.createElement("div");
		dateDiv.className = "timeline-date";

		if (r.date !== lastDate) {
			dateDiv.textContent = formattedDate;
		}

		left.appendChild(dateDiv);

		// MIDDLE COLUMN
		const middle = document.createElement("div");
		middle.className = "timeline-middle";

		// RIGHT COLUMN
		const right = document.createElement("div");
		right.className = "timeline-component timeline-component-bg";
		if (isLast) right.classList.add("timeline-component-bottom");

		if (r.date !== lastDate) {
			const point = document.createElement("div");
			point.className = "timeline-point";
			middle.appendChild(point);

			if (isLast) {
				const bottomPoint = document.createElement("div");
				bottomPoint.className = "timeline-point timeline-point-bottom";
				middle.appendChild(bottomPoint);
			} else {
				right.classList.add("timeline-component-new-date");
			}
		}

		// Title container
		const title = document.createElement("h2");
		title.className = "timeline-title";
		const artistSpan = document.createElement("span");
		artistSpan.className = "artist-span";
		artistSpan.textContent = r.artist;
		const titleSpan = document.createElement("span");
		titleSpan.className = "title-span";
		titleSpan.textContent = r.title;

		const play_button = document.createElement("span");
		play_button.className = "play-button";
		play_button.setAttribute("data-src", "music/" + encodeURIComponent(r["file-name"]));
		play_button.setAttribute("data-artist", r.artist);
		play_button.setAttribute("data-title", r.title);
		play_button.setAttribute("data-ID", r.ID);

		const top_bar_title = document.querySelectorAll("span.top-bar-title")[0];
		if (top_bar_title.getAttribute("data-ID") === r.ID) play_button.classList.add("playing");

		title.appendChild(play_button);
		title.appendChild(titleSpan);
		title.appendChild(artistSpan);

		const infoDiv = document.createElement("div");
		infoDiv.className = "timeline-entry-info";

		const durationSpan = document.createElement("span");
		durationSpan.className = "duration-span";
		durationSpan.innerHTML = formatDuration(r.duration);

		const performancesSpan = document.createElement("span");
		performancesSpan.className = "performances-span";
		performancesSpan.textContent = "Performance " + r["performance-number"] + "/" + r["total-performances"];

		const midi_button = document.createElement("button");
		midi_button.className = "midi-button";
		midi_button.textContent = "NOTES";
		midi_button.dataset.recording = JSON.stringify(r);

		infoDiv.appendChild(durationSpan);
		infoDiv.appendChild(performancesSpan);
		if (r["midi-file-name"].trim() !== "") infoDiv.appendChild(midi_button);

		right.appendChild(title);
		right.appendChild(infoDiv);

		timeline.appendChild(left);
		timeline.appendChild(middle);
		timeline.appendChild(right);

		lastDate = r.date;
	}
	if (firstTime) {
		sortedArtists = [...allArtists].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
		sortedYears = [...allYears].sort((a, b) => b - a);
	}
}

function checkFilters(jsonEntry) {
	var searchFilterPassed = false;
	var categoryFilterPassed = true;

	if (searchFilter.trim() === "") searchFilterPassed = true;
	else {
		searchFilterPassed = jsonEntry.artist.toLowerCase().includes(searchFilter.toLowerCase().trim()) || jsonEntry.title.toLowerCase().includes(searchFilter.toLowerCase().trim()) || jsonEntry["extra-info"].toLowerCase().includes(searchFilter.toLowerCase().trim());
	}

	return searchFilterPassed && categoryFilterPassed;
}

async function refreshTimeline() {
	const timeline = document.querySelector(".timeline");
	timeline.style.opacity = 0;
	requestAnimationFrame(() => {
		timeline.innerHTML = "";
		loadTimeline().then(() => {
			timeline.style.opacity = 1;
			preparePlayback();
		});
	});
}

function formatDate(dateStr) {
	const [day, month, year] = dateStr.split(".").map(Number);
	const dateObj = new Date(year, month - 1, day);

	return dateObj.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

function getYearFromDate(dateStr) {
	const [day, month, year] = dateStr.split(".").map(Number);
	return year;
}

function preparePlayback() {
	const entries = document.querySelectorAll("span.play-button");
	const player = document.querySelectorAll("div.top-bar > audio.top-player")[0];
	const volume_slider = document.querySelector("#visualizer-volume > input.volume-slider");
	const top_bar_title = document.querySelectorAll("span.top-bar-title")[0];

	entries.forEach((entry) => {
		entry.addEventListener("click", () => {
			if (entry.classList.contains("playing")) {
				player.src = "";
				entry.classList.remove("playing");
				top_bar_title.textContent = "";
				top_bar_title.setAttribute("data-ID", "");
			} else {
				entries.forEach((other) => {
					if (other !== entry) {
						other.classList.remove("playing");
					}
				});
				entry.classList.add("playing");
				player.src = entry.getAttribute("data-src");
				player.play();
				top_bar_title.textContent = entry.getAttribute("data-title");
				top_bar_title.setAttribute("data-ID", entry.getAttribute("data-ID"));
			}
		});
	});
	volume_slider.addEventListener("input", () => {
		player.volume = parseFloat(volume_slider.value);
	});

	document.querySelectorAll(".midi-button").forEach((button) => {
		button.addEventListener("click", async (event) => {
			const rec = JSON.parse(button.dataset.recording);
			await openVisualizationFor(rec, entries, top_bar_title);
		});
	});
}

function downloadNotesAsFile(filename, notes) {
	let text = "";
	for (const n of notes) {
		text += n.infoToString();
	}

	const blob = new Blob([text], { type: "text/plain" });
	const url = URL.createObjectURL(blob);

	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();

	URL.revokeObjectURL(url);
}

function closeVisualization() {
	const container = document.querySelector(".midi-visualizer-container");
	if (!container.classList.contains("active")) return;
	const player = document.querySelectorAll("div.top-bar > audio.top-player")[0];
	player.src = "";
	container.classList.remove("active");
	if (visualizer) {
		visualizer.stop();
		visualizer = null;
	}
	// Clear the hash without scrolling/jumping
	if (history.replaceState) {
		history.replaceState(null, "", window.location.pathname + window.location.search);
	} else {
		location.hash = "";
	}
}

async function openVisualizationFor(rec, entries, top_bar_title) {
	const container = document.querySelector(".midi-visualizer-container");
	if (container.classList.contains("active")) return;
	container.classList.add("active");
	// Update the URL hash so the view is shareable
	if (history.replaceState) {
		history.replaceState(null, "", "#midi=" + rec.ID);
	} else {
		location.hash = "midi=" + rec.ID;
	}
	visualizer = await loadRecording(rec);
	if (entries) {
		entries.forEach((entry) => {
			entry.classList.remove("playing");
		});
	}
	if (top_bar_title) top_bar_title.textContent = "";
}

async function handleMidiHash() {
	const match = window.location.hash.match(/^#midi=([a-zA-Z0-9]+)/);
	if (!match) return;
	const targetID = match[1];

	// Fetch list.json to find the matching recording
	try {
		const response = await fetch("music/list.json");
		const json = await response.json();
		const rec = json.data.find((r) => r.ID === targetID);
		if (!rec) {
			console.warn("No recording found for ID:", targetID);
			return;
		}
		if (!rec["midi-file-name"] || rec["midi-file-name"].trim() === "") {
			console.warn("Recording has no MIDI file:", targetID);
			return;
		}
		const entries = document.querySelectorAll("span.play-button");
		const top_bar_title = document.querySelectorAll("span.top-bar-title")[0];
		await openVisualizationFor(rec, entries, top_bar_title);
	} catch (err) {
		console.error("Error handling MIDI hash:", err);
	}
}

loadTimeline(true).then(() => {
	const player = document.querySelector("div.top-bar > audio.top-player");
	player.volume = 0.5;
	preparePlayback();
	const search_textbox = document.querySelectorAll("input#search-textbox")[0];
	search_textbox.addEventListener("input", (e) => {
		searchFilter = e.target.value;
		refreshTimeline();
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			closeVisualization();
		}
	});
	document.getElementById("visualizer-close-button").addEventListener("click", () => {
		closeVisualization();
	});

	// Check the hash on initial load
	handleMidiHash();

	// Also react if the user changes the hash manually (or via back/forward)
	window.addEventListener("hashchange", () => {
		// If a visualizer is already open and the hash changed/cleared, close it first
		const container = document.querySelector(".midi-visualizer-container");
		if (container.classList.contains("active")) {
			closeVisualization();
		}
		handleMidiHash();
	});

	document.querySelector(".midi-visualizer").addEventListener("click", (event) => {
		// Only close if the click landed directly on the backdrop,
		// not on the canvas, controls, or anything inside the wrapper
		if (event.target.classList.contains("midi-visualizer")) {
			closeVisualization();
		}
	});
});
