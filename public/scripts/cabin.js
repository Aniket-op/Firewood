import Stream from "./Stream.js";
import Video from "./Video.js";
import { UserStream } from "./UserStream.js";

// Constants
const VIDEO_GRID_ID = "video-grid";
const IDEAL_VIDEO_WIDTH = 1920;
const IDEAL_VIDEO_HEIGHT = 1080;
const LEAVE_REDIRECT_DELAY = 450;

// State management
const state = {
    socket: io('/'),
    peer: new Peer(USER_ID),
    localStream: null,
    originalStream: null,
    screenStream: null,
    users: {},
    peers: {},
    facing: "user",
    isScreenSharing: false,
    hasLeft: false,
    gridNumber: 1
};

// Make state accessible globally for debugging
window.appState = state;

// Audio feedback
const sounds = {
    userLeave: new Audio('.././sounds/userLeave.ogg'),
    userJoin: new Audio('.././sounds/userJoin.ogg'),
    leave: new Audio('.././sounds/leave.ogg')
};

// Check device capabilities
const deviceCapabilities = navigator.mediaDevices.getSupportedConstraints();

// Detect if device is mobile
const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

console.log("Device capabilities:", deviceCapabilities);
console.log("Is mobile device:", isMobileDevice);

// Flickity setup for carousel
const flkty = new Flickity('.main-gallery', {
    contain: true,
    wrapAround: true,
    draggable: ">1"
});

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initialize() {
    try {
        const stream = await new Stream().getLocal();
        handleInitialStream(stream);
        setupPeerListeners();
        setupSocketListeners();
    } catch (error) {
        console.error("Failed to initialize:", error);
        alert("Failed to access camera and microphone. Please check your permissions.");
    }
}

function handleInitialStream(stream) {
    state.localStream = stream;
    state.originalStream = stream;

    const userStream = new UserStream(USER_ID, USERNAME, stream, true);
    const videoElement = new Video(userStream.constructLocalVideo(`You (${USERNAME})`));
    videoElement.appendGrid(`${VIDEO_GRID_ID}${state.gridNumber}`);

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
        const settings = videoTrack.getSettings();
        console.log(`Video resolution: ${settings.width}x${settings.height}`);
    }

    // Add status indicators for local user
    addStatusIndicators(USER_ID);

    state.socket.emit('join-cabin', CABIN_ADDRESS, USER_ID, USERNAME);
}

// ============================================================================
// PEER CONNECTION MANAGEMENT
// ============================================================================

function setupPeerListeners() {
    state.peer.on('call', handleIncomingCall);
}

function handleIncomingCall(call) {
    call.answer(state.localStream);

    call.on('stream', userVideoStream => {
        addRemoteUser(call.metadata.id, call.metadata.username, userVideoStream);
        setupStreamTrackListeners(userVideoStream, call.metadata.id);
    });

    call.on('close', () => {
        removeUser(call.metadata.id);
    });

    state.peers[call.metadata.id] = call;
}

async function connectToNewUser(userId, username, stream) {
    const options = {
        metadata: {
            id: USER_ID,
            username: USERNAME
        }
    };

    const call = state.peer.call(userId, stream, options);

    call.on('stream', remoteStream => {
        addRemoteUser(userId, username, remoteStream);
        setupStreamTrackListeners(remoteStream, userId);
    });

    call.on('close', () => {
        removeUser(userId);
    });

    state.peers[userId] = call;
}

function addRemoteUser(userId, username, stream) {
    // Prevent duplicate additions
    if (state.users[userId]) {
        console.log(`User ${username} already exists, skipping...`);
        return;
    }

    const userStream = new UserStream(userId, username, stream);
    const videoElement = new Video(userStream.constructLocalVideo());

    videoElement.appendGrid(`${VIDEO_GRID_ID}${state.gridNumber}`);
    calculateGrid();

    state.users[userId] = videoElement;

    // Add status indicators to the video container
    addStatusIndicators(userId);

    console.log(`Added user: ${username} (${userId})`);
}

function addStatusIndicators(userId) {
    const videoContainer = document.getElementById(`div-${userId}`);
    if (!videoContainer) return;

    // Create muted indicator
    const mutedIndicator = document.createElement('div');
    mutedIndicator.className = 'status-indicator muted-indicator';
    mutedIndicator.id = `muted-${userId}`;
    mutedIndicator.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';
    mutedIndicator.style.display = 'none';

    // Create video off indicator
    const videoOffIndicator = document.createElement('div');
    videoOffIndicator.className = 'status-indicator video-off-indicator';
    videoOffIndicator.id = `video-off-${userId}`;
    videoOffIndicator.innerHTML = '<i class="bi bi-camera-video-off-fill"></i>';
    videoOffIndicator.style.display = 'none';

    videoContainer.appendChild(mutedIndicator);
    videoContainer.appendChild(videoOffIndicator);
}

function setupStreamTrackListeners(stream, userId) {
    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];

    if (audioTrack) {
        // Check initial state
        updateMutedIndicator(userId, !audioTrack.enabled);

        // Listen for changes (note: some browsers may not fire this event reliably)
        audioTrack.addEventListener('ended', () => {
            updateMutedIndicator(userId, true);
        });

        // Poll for track enabled changes since not all browsers fire events reliably
        setInterval(() => {
            updateMutedIndicator(userId, !audioTrack.enabled);
        }, 1000);
    }

    if (videoTrack) {
        // Check initial state
        updateVideoOffIndicator(userId, !videoTrack.enabled);

        // Listen for changes
        videoTrack.addEventListener('ended', () => {
            updateVideoOffIndicator(userId, true);
        });

        // Poll for track enabled changes
        setInterval(() => {
            updateVideoOffIndicator(userId, !videoTrack.enabled);
        }, 1000);
    }
}

function updateMutedIndicator(userId, isMuted) {
    const indicator = document.getElementById(`muted-${userId}`);
    if (indicator) {
        indicator.style.display = isMuted ? 'flex' : 'none';
    }
}

function updateVideoOffIndicator(userId, isVideoOff) {
    const indicator = document.getElementById(`video-off-${userId}`);
    if (indicator) {
        indicator.style.display = isVideoOff ? 'flex' : 'none';
    }
}

function removeUser(userId) {
    const userVideo = state.users[userId];
    if (userVideo) {
        userVideo.getVideo().remove();
        delete state.users[userId];
    }

    const peerConnection = state.peers[userId];
    if (peerConnection) {
        peerConnection.close();
        delete state.peers[userId];
    }
}

// ============================================================================
// SOCKET EVENT HANDLERS
// ============================================================================

function setupSocketListeners() {
    state.socket.on('user-connected', handleUserConnected);
    state.socket.on('user-disconnected', handleUserDisconnected);
}

function handleUserConnected(userId, username) {
    console.log(`${username} (${userId}) connected`);
    sounds.userJoin.play().catch(err => console.log("Audio play blocked:", err));
    connectToNewUser(userId, username, state.localStream);
}

function handleUserDisconnected(userId, username) {
    console.log(`${username} (${userId}) disconnected`);

    if (userId === USER_ID) {
        console.log("You left the room");
        return;
    }

    const userElement = document.getElementById(`div-${userId}`);
    if (userElement) {
        userElement.remove();
    }

    removeUser(userId);
    calculateGrid();
    sounds.userLeave.play().catch(err => console.log("Audio play blocked:", err));
}

// ============================================================================
// MEDIA TRACK MANAGEMENT
// ============================================================================

function replaceVideoTrackForAllPeers(newVideoTrack) {
    Object.values(state.peers).forEach(call => {
        const sender = call.peerConnection
            .getSenders()
            .find(s => s.track && s.track.kind === 'video');

        if (sender) {
            sender.replaceTrack(newVideoTrack).catch(err => {
                console.error("Error replacing track for peer:", err);
            });
        }
    });
}

function updateLocalVideoElement(stream) {
    const localVideoElement = document.getElementById(`video-${USER_ID}`);
    if (localVideoElement) {
        localVideoElement.srcObject = stream;
    }
}

async function switchVideoSource(getNewStream) {
    try {
        const newStream = await getNewStream();

        // Stop old video track
        const oldVideoTrack = state.localStream.getVideoTracks()[0];
        if (oldVideoTrack) {
            oldVideoTrack.stop();
            state.localStream.removeTrack(oldVideoTrack);
        }

        // Add new video track
        const newVideoTrack = newStream.getVideoTracks()[0];
        state.localStream.addTrack(newVideoTrack);

        // Update UI and peers
        updateLocalVideoElement(state.localStream);
        replaceVideoTrackForAllPeers(newVideoTrack);

        return newStream;
    } catch (error) {
        console.error("Error switching video source:", error);
        throw error;
    }
}

// ============================================================================
// CAMERA FLIP
// ============================================================================

async function flipCamera() {
    if (!deviceCapabilities.facingMode) {
        alert("Camera flipping is not supported on this device");
        return;
    }

    const newFacingMode = state.facing === "user" ? "environment" : "user";

    try {
        await switchVideoSource(async () => {
            return navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: IDEAL_VIDEO_WIDTH },
                    height: { ideal: IDEAL_VIDEO_HEIGHT },
                    facingMode: newFacingMode
                },
                audio: true
            });
        });

        state.facing = newFacingMode;
        console.log(`Camera flipped to ${state.facing}`);
    } catch (error) {
        console.error("Error flipping camera:", error);
        alert("Failed to flip camera. Please try again.");
    }
}

// ============================================================================
// SCREEN SHARING
// ============================================================================

async function toggleScreenShare() {
    if (state.isScreenSharing) {
        await stopScreenShare();
    } else {
        await startScreenShare();
    }
}

async function startScreenShare() {
    // iOS doesn't support getDisplayMedia
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        alert("Screen sharing is not supported on iOS devices");
        return;
    }

    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always" },
            audio: false
        });

        state.screenStream = screenStream;

        await switchVideoSource(async () => screenStream);

        state.isScreenSharing = true;
        updateScreenShareButton(true);

        // Add class to prevent mirroring during screen share
        const localVideoContainer = document.getElementById(`div-${USER_ID}`);
        if (localVideoContainer) {
            localVideoContainer.classList.add('screen-sharing');
        }

        // Handle when user stops sharing via browser UI
        const screenTrack = screenStream.getVideoTracks()[0];
        screenTrack.onended = () => {
            stopScreenShare();
        };

        console.log("Screen sharing started");
    } catch (error) {
        console.error("Error starting screen share:", error);
        if (error.name !== 'NotAllowedError') {
            alert("Failed to share screen. Please try again.");
        }
    }
}

async function stopScreenShare() {
    if (!state.screenStream) return;

    // Stop screen tracks
    state.screenStream.getTracks().forEach(track => track.stop());
    state.screenStream = null;

    try {
        // Return to camera
        await switchVideoSource(async () => {
            return navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: IDEAL_VIDEO_WIDTH },
                    height: { ideal: IDEAL_VIDEO_HEIGHT },
                    facingMode: state.facing
                },
                audio: true
            });
        });

        state.isScreenSharing = false;
        updateScreenShareButton(false);

        // Remove screen sharing class to restore mirroring
        const localVideoContainer = document.getElementById(`div-${USER_ID}`);
        if (localVideoContainer) {
            localVideoContainer.classList.remove('screen-sharing');
        }

        console.log("Screen sharing stopped");
    } catch (error) {
        console.error("Error stopping screen share:", error);
        alert("Failed to return to camera. Please refresh the page.");
    }
}

function updateScreenShareButton(isSharing) {
    const btn = document.getElementById("share-screen");
    if (!btn) return;

    const icon = btn.children[0];
    if (isSharing) {
        icon.classList.remove("bi-display");
        icon.classList.add("bi-camera-video-fill");
        btn.setAttribute("title", "Stop sharing");
    } else {
        icon.classList.add("bi-display");
        icon.classList.remove("bi-camera-video-fill");
        btn.setAttribute("title", "Share screen");
    }
}

// ============================================================================
// GRID LAYOUT CALCULATION
// ============================================================================

function calculateGrid() {
    const userCount = document.querySelectorAll(".video-container").length;
    state.gridNumber = Math.ceil(userCount / 4);

    const grids = document.querySelectorAll(".video-grid");
    const type = getComputedStyle(document.documentElement)
        .getPropertyValue("--type");

    grids.forEach((grid, index) => {
        const videoContainers = grid.querySelectorAll(".video-container");
        const gridLength = videoContainers.length;

        // Remove empty grids
        if (gridLength === 0) {
            flkty.remove(grid);
            state.gridNumber--;
            return;
        }

        // Create new grid if more than 4 users
        if (gridLength > 4) {
            const container = videoContainers[0];
            state.gridNumber++;

            const newGrid = document.createElement('div');
            newGrid.className = "video-grid gallery-cell";
            newGrid.id = `${VIDEO_GRID_ID}${index + 2}`;
            newGrid.appendChild(container);

            flkty.append(newGrid);
            flkty.selectCell(index + 1);
            return;
        }

        // Calculate grid dimensions
        const layout = calculateGridLayout(gridLength, type);
        grid.style.setProperty("--grid-rows", layout.rows);
        grid.style.setProperty("--grid-columns", layout.columns);
    });
}

function calculateGridLayout(userCount, orientation) {
    const isVertical = orientation === "vertical";

    const layouts = {
        vertical: [
            { rows: 1, columns: 1 }, // 1 user
            { rows: 2, columns: 1 }, // 2 users
            { rows: 3, columns: 1 }, // 3 users
            { rows: 2, columns: 2 }  // 4 users
        ],
        horizontal: [
            { rows: 1, columns: 1 }, // 1 user
            { rows: 1, columns: 2 }, // 2 users
            { rows: 1, columns: 3 }, // 3 users
            { rows: 2, columns: 2 }  // 4 users
        ]
    };

    const layoutSet = isVertical ? layouts.vertical : layouts.horizontal;
    return layoutSet[userCount - 1] || { rows: 2, columns: 2 };
}

// ============================================================================
// MEDIA CONTROLS
// ============================================================================

function toggleMediaTrack(trackType) {
    const track = state.localStream
        .getTracks()
        .find(t => t.kind === trackType);

    if (!track) return;

    track.enabled = !track.enabled;
    updateControlButton(trackType, track.enabled);

    // Update local user's status indicator
    if (trackType === 'audio') {
        updateMutedIndicator(USER_ID, !track.enabled);
    } else if (trackType === 'video') {
        updateVideoOffIndicator(USER_ID, !track.enabled);
    }
}

function updateControlButton(trackType, isEnabled) {
    const buttons = {
        video: {
            element: document.getElementById("toggle-camera"),
            onIcon: "bi-camera-video-fill",
            offIcon: "bi-camera-video-off-fill"
        },
        audio: {
            element: document.getElementById("toggle-mic"),
            onIcon: "bi-mic-fill",
            offIcon: "bi-mic-mute-fill"
        }
    };

    const button = buttons[trackType];
    if (!button || !button.element) return;

    const icon = button.element.children[0];

    if (isEnabled) {
        icon.classList.add(button.onIcon);
        icon.classList.remove(button.offIcon, "toggled");
    } else {
        icon.classList.remove(button.onIcon);
        icon.classList.add(button.offIcon, "toggled");
    }
}

// ============================================================================
// DISCONNECT & CLEANUP
// ============================================================================

function disconnect() {
    // Stop all local tracks
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => track.stop());
    }
    if (state.screenStream) {
        state.screenStream.getTracks().forEach(track => track.stop());
    }

    // Close all peer connections
    Object.values(state.peers).forEach(peer => {
        if (peer.close) peer.close();
    });

    // Destroy peer and notify server
    if (state.peer && state.peer.destroy) {
        state.peer.destroy();
    }

    state.socket.emit('leave-cabin');
    console.log("Disconnected and cleaned up");
}

function handleLeave() {
    if (state.hasLeft) return;

    disconnect();
    sounds.leave.play().catch(err => console.log("Audio play blocked:", err));
    state.hasLeft = true;

    setTimeout(() => {
        window.location.replace("/");
    }, LEAVE_REDIRECT_DELAY);
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
    // Media controls
    const toggleCamera = document.getElementById("toggle-camera");
    const toggleMic = document.getElementById("toggle-mic");
    const leaveBtn = document.getElementById("leave");
    const flipCameraBtn = document.getElementById("flip-camera");
    const shareScreenBtn = document.getElementById("share-screen");
    const debugBtn = document.getElementById("debug");

    if (toggleCamera) {
        toggleCamera.addEventListener('click', (e) => {
            e.preventDefault();
            toggleMediaTrack("video");
        });
    }

    if (toggleMic) {
        toggleMic.addEventListener('click', (e) => {
            e.preventDefault();
            toggleMediaTrack("audio");
        });
    }

    if (leaveBtn) {
        leaveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleLeave();
        });
    }

    // Flip camera (hide if not supported or not mobile)
    if (flipCameraBtn) {
        if (!deviceCapabilities.facingMode || !isMobileDevice) {
            flipCameraBtn.style.display = 'none';
        } else {
            flipCameraBtn.addEventListener('click', (e) => {
                e.preventDefault();
                flipCamera();
            });
        }
    }

    // Screen share (hide on iOS)
    if (shareScreenBtn) {
        if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            shareScreenBtn.style.display = 'none';
        } else {
            shareScreenBtn.addEventListener('click', (e) => {
                e.preventDefault();
                toggleScreenShare();
            });
        }
    }

    // Debug utilities
    if (debugBtn) {
        debugBtn.addEventListener('click', () => {
            console.log("Current state:", state);
            console.log("Peers:", state.peers);
            console.log("Users:", state.users);
            calculateGrid();
        });
    }

    // Window events
    window.addEventListener('resize', calculateGrid);
    window.addEventListener('beforeunload', disconnect);
}

// ============================================================================
// START APPLICATION
// ============================================================================

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setupEventListeners();
        initialize();
    });
} else {
    setupEventListeners();
    initialize();
}