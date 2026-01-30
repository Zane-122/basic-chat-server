// Connect to WebSocket server
let ws = null;
let connected = false;

const connectionList = document.getElementById('connection-list');
const statusDiv = document.querySelector('.status');
const messageList = document.getElementById('message-list');
const messageInput = document.getElementById('message-input');
const senderName = document.getElementById('sender-name');
const connectButton = document.getElementById('connect-button');
const roomPassword = document.getElementById('room-password');

// Get room hash from password (for filtering connections)
function getRoomHash() {
    var password = document.getElementById('room-password').value;
    if (!password) return '';
    return CryptoJS.SHA256(password).toString();
}

// Encryption functions using CryptoJS (works on HTTP)
function encryptMessage(text, password) {
    try {
        var encrypted = CryptoJS.AES.encrypt(text, password).toString();
        return encrypted;
    } catch (e) {
        console.error('Encryption failed:', e);
        return null;
    }
}

function decryptMessage(encryptedText, password) {
    try {
        var decrypted = CryptoJS.AES.decrypt(encryptedText, password);
        var result = decrypted.toString(CryptoJS.enc.Utf8);
        return result || null;
    } catch (e) {
        console.error('Decryption failed:', e);
        return null;
    }
}

let connections = [];
let messages = [];
let myConnection = {address: '', name: ''};
let replyingTo = null; // { id, content, sender }

// Load saved name from localStorage if it exists
if (localStorage.getItem('chatName')) {
    senderName.value = localStorage.getItem('chatName');
    myConnection.name = senderName.value;
}

function updateStatus(message, isError = false) {
    statusDiv.textContent = message;
    statusDiv.style.backgroundColor = isError ? '#f8d7da' : '#d4edda';
    statusDiv.style.color = isError ? '#721c24' : '#155724';
}

updateStatus("Disconnected from server, you can change your name", true);

function updateConnectionState(isConnected) {
    connected = isConnected;
    senderName.disabled = isConnected;
    roomPassword.disabled = isConnected;
    connectButton.textContent = isConnected ? 'Disconnect' : 'Connect';
    connectButton.onclick = isConnected ? disconnectFromServer : connectToServer;
}

function disconnectFromServer() {
    if (ws) {
        ws.close();
    }
    updateConnectionState(false);
    updateStatus("Disconnected from server, you can change your name", true);
    connections = [];
    updateConnectionList();
}

function connectToServer() {
    if (ws) {
        ws.close();
    }
    
    updateConnectionState(false);
    updateStatus("Connecting...");

    // Set name before connecting
    myConnection.name = senderName.value.trim();
    if (!myConnection.name) {
        updateStatus("Please enter a name", true);
        return;
    }
    localStorage.setItem('chatName', myConnection.name);

    ws = new WebSocket('ws://' + window.location.hostname + ':4001/ws');

    ws.onopen = function() {
        updateStatus('Connected to server');
        updateConnectionState(true);
    };

    ws.onclose = function() {
        updateConnectionState(false);
        updateStatus('Disconnected from server', true);
    };

    ws.onerror = function(error) {
        updateConnectionState(false);
        updateStatus('Connection error: ' + error.message, true);
    };

    ws.onmessage = function(event) {
        console.log('Received message:', event.data);
        let eventDataJson = '';
        try {
            eventDataJson = JSON.parse(event.data);
        } catch {
            console.error("NOT A JSON");
        }

        if (event.data.startsWith('New connection:')) {
            // Don't add to connections list here - wait for name-update with room info
            const fullAddress = event.data.split(':')[1].trim();
            console.log("NEW CONNECTION (waiting for name-update):", fullAddress);
        } else if (event.data.startsWith('Closed connection:')) {
            const fullAddress = event.data.split(':')[1].trim();
            console.log("CLOSED CONNECTION");
            connections = connections.filter(conn => conn.address !== fullAddress);
            updateConnectionList();
        } else if (eventDataJson.type === "name-update" || eventDataJson.type === "update-name") {
            const address = eventDataJson.address;
            const name = eventDataJson.name;
            const userRoomHash = eventDataJson.roomHash || '';

            console.log("NAME UPDATE", address, name, "room:", userRoomHash);
            
            // Update connection name and room hash
            let connection = connections.find(conn => conn.address === address);
            if (connection) {
                connection.name = name;
                connection.roomHash = userRoomHash;
            } else {
                connections.push({address: address, name: name, roomHash: userRoomHash});
            }

            // Update my name if it's my address
            if (address === myConnection.address) {
                myConnection.name = name;
            }
            
            updateConnectionList();
        } else if (eventDataJson.type === "encrypted") {
            // Decrypt the message
            const password = roomPassword.value;
            const decrypted = decryptMessage(eventDataJson.data, password);
            if (decrypted) {
                try {
                    const messageData = JSON.parse(decrypted);
                    if (messageData.type === "message") {
                        const isOwnMessage = messageData.senderAddress === myConnection.address;
                        const sender = isOwnMessage ? 'You' : messageData.sender;
                        const timestamp = new Date().toLocaleTimeString();
                        var contentText = messageData.content ? `${sender}: ${messageData.content}` : sender + ':';
                        messages.push({
                            id: messageData.id,
                            content: contentText,
                            rawContent: messageData.content,
                            sender: messageData.sender,
                            timestamp: timestamp,
                            attachment: messageData.attachment || null,
                            isOwn: isOwnMessage,
                            replyTo: messageData.replyTo || null
                        });
                        updateMessageList();
                    }
                } catch (e) {
                    console.error('Error parsing decrypted message:', e);
                }
            } else {
                // // Wrong password - show as encrypted
                // messages.push({
                //     content: '[Encrypted message - wrong password]',
                //     timestamp: new Date().toLocaleTimeString(),
                //     attachment: null,
                //     isOwn: false
                // });
                // updateMessageList();
            }
        } else if (eventDataJson.type === "message") {
            // Legacy unencrypted message support
            try {
                const messageData = JSON.parse(event.data);
                console.log('Parsed message data:', messageData);
                const isOwnMessage = messageData.senderAddress === myConnection.address;
                const sender = isOwnMessage ? 'You' : messageData.sender;
                const timestamp = new Date().toLocaleTimeString();
                var contentText = messageData.content ? `${sender}: ${messageData.content}` : sender + ':';
                messages.push({
                    content: contentText,
                    timestamp: timestamp,
                    attachment: messageData.attachment || null,
                    isOwn: isOwnMessage
                });
                updateMessageList();
            } catch (e) {
                console.error('Error parsing message:', e);
            }
        } else if (event.data.startsWith("Your address:")) {
            myConnection.address = event.data.split(":")[1].trim();
            // Send initial name update immediately after getting address with room hash
            var roomHash = getRoomHash();
            fetch('/update-name', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    address: myConnection.address,
                    name: myConnection.name,
                    roomHash: roomHash
                })
            });
        }
    };
}

function updateConnectionList() {
    var myRoomHash = getRoomHash();
    
    // Filter connections to only show those in the same room
    var sameRoomConnections = connections.filter(conn => {
        // Always show yourself
        if (conn.address === myConnection.address) return true;
        // Don't show users who haven't set their room yet (roomHash is undefined)
        if (conn.roomHash === undefined) return false;
        // Only show if room hashes match exactly (empty matches empty, key matches same key)
        return myRoomHash === conn.roomHash;
    });
    
    connectionList.innerHTML = sameRoomConnections.length ? 
        sameRoomConnections.map(conn => {
            if (conn.address === myConnection.address) {
                return `<li>You (${myConnection.name})</li>`;
            }
            return `<li>${conn.name || conn.address}</li>`;
        }).join('') :
        '<li class="empty-message">No active connections</li>';
}

function cleanAddress(address) {
    // Remove the leading slash and brackets
    address = address.replace(/^\/\[|\]$/g, '');
    // Replace IPv6 localhost with "localhost"
    if (address.startsWith('0:0:0:0:0:0:0:1')) {
        return 'localhost';
    }
    return address;
}

function sendMessage() {
    const message = messageInput.value.trim();
    if ((message || pendingFile) && myConnection.address !== '') {
        console.log('Sending message:', message);
        var msgId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        var msgData = {
            type: "message",
            id: msgId,
            content: message,
            sender: myConnection.name,
            senderAddress: myConnection.address,
            timestamp: new Date().toLocaleTimeString(),
            replyTo: replyingTo ? { id: replyingTo.id, content: replyingTo.content, sender: replyingTo.sender } : null
        };
        replyingTo = null;
        updateReplyPreview();
        if (pendingFile) {
            msgData.attachment = pendingFile;
            saveImageToCache(pendingFile);
            pendingFile = null;
            var p = document.getElementById('file-preview');
            if (p) p.style.display = 'none';
        }
        
        // Encrypt the message
        const password = roomPassword.value;
        const encrypted = encryptMessage(JSON.stringify(msgData), password);
        if (encrypted) {
            ws.send(JSON.stringify({ type: 'encrypted', data: encrypted }));
        }
        messageInput.value = '';
    }
}

function clearMessages() {
    messages = [];
    updateMessageList();
}

function updateMessageList() {
    messageList.innerHTML = messages.length ? 
        messages.map((msg, index) => {
            const isOwnMessage = msg.isOwn === true;
            
            var attachHtml = '';
            if (msg.attachment) {
                if (msg.attachment.type && msg.attachment.type.startsWith('image/')) {
                    attachHtml = '<br><img src="' + msg.attachment.data + '" style="max-width:200px;max-height:150px;margin-top:8px;cursor:pointer;border-radius:4px;" onclick="showSaveImagePopup(this.src)">';
                } else {
                    attachHtml = '<br><a href="' + msg.attachment.data + '" download="' + msg.attachment.name + '" style="display:inline-block;margin-top:8px;padding:6px 10px;background:#e9ecef;border-radius:4px;color:#495057;text-decoration:none;font-size:13px;">' + msg.attachment.name + '</a>';
                }
            }
            var displayContent = msg.content.endsWith(':') && attachHtml ? msg.content.slice(0, -1) : msg.content;
            var replyHtml = '';
            if (msg.replyTo) {
                var replyPreview = msg.replyTo.content ? msg.replyTo.content.substring(0, 40) : '[attachment]';
                if (msg.replyTo.content && msg.replyTo.content.length > 40) replyPreview += '...';
                var replySender = msg.replyTo.sender === myConnection.name ? 'You' : msg.replyTo.sender;
                replyHtml = '<div class="reply-wrapper">' +
                    '<div class="reply-original"><span class="reply-label">Reply to </span><span class="reply-original-sender">' + replySender + ':</span> <span class="reply-original-text">' + replyPreview + '</span></div>' +
                '</div>';
            }
            return `<li class="${isOwnMessage ? 'own-message' : ''}" data-msgid="${msg.id || ''}" data-content="${(msg.rawContent || '').replace(/"/g, '&quot;')}" data-sender="${(msg.sender || 'Unknown').replace(/"/g, '&quot;')}">
                ${replyHtml}
                <div class="message-row">
                    <span class="message-content">${displayContent}${attachHtml}</span>
                    <span class="message-timestamp">${msg.timestamp}</span>
                </div>
            </li>`;
        }).join('') :
        '<li style="text-align: center; color: #6c757d;">No messages yet</li>';
    
    messageList.scrollTop = messageList.scrollHeight;
    
    // Add long-press handlers for context menu
    document.querySelectorAll('.message-list li[data-msgid]').forEach(function(li) {
        var holdTimer = null;
        var isHolding = false;
        var startX = 0, startY = 0;
        
        function handleLongPress(e, clientX, clientY) {
            var msgId = li.getAttribute('data-msgid');
            var content = li.getAttribute('data-content');
            var sender = li.getAttribute('data-sender');
            
            if (msgId) {
                li.style.transform = 'scale(0.98)';
                setTimeout(function() { li.style.transform = ''; }, 150);
                setReply(msgId, content, sender);
            }
        }
        
        li.addEventListener('mousedown', function(e) {
            isHolding = true;
            startX = e.clientX;
            startY = e.clientY;
            holdTimer = setTimeout(function() {
                if (isHolding) {
                    handleLongPress(e, startX, startY);
                }
            }, 500);
        });
        
        li.addEventListener('mouseup', function() {
            isHolding = false;
            clearTimeout(holdTimer);
        });
        
        li.addEventListener('mouseleave', function() {
            isHolding = false;
            clearTimeout(holdTimer);
        });
        
        // Touch support for mobile
        li.addEventListener('touchstart', function(e) {
            isHolding = true;
            var touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            holdTimer = setTimeout(function() {
                if (isHolding) {
                    handleLongPress(e, startX, startY);
                }
            }, 500);
        });
        
        li.addEventListener('touchend', function() {
            isHolding = false;
            clearTimeout(holdTimer);
        });
        
        li.addEventListener('touchcancel', function() {
            isHolding = false;
            clearTimeout(holdTimer);
        });
    });
}

// Image save popup functions
function showSaveImagePopup(imgSrc) {
    var overlay = document.getElementById('context-menu-overlay');
    var popup = document.getElementById('context-menu');
    
    popup.innerHTML = '<div style="padding:24px 28px;text-align:center;background:white;border-radius:16px;">' +
        '<div style="padding:16px;margin-bottom:16px;">' +
        '<img src="' + imgSrc + '" style="max-width:220px;max-height:180px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.15);">' +
        '</div>' +
        '<p style="margin:0 0 20px 0;color:#333;font-size:16px;font-weight:500;">Save to Recent Images?</p>' +
        '<div style="display:flex;gap:12px;justify-content:center;">' +
        '<button onclick="confirmSaveImage(\'' + imgSrc.replace(/'/g, "\\'") + '\')" style="padding:10px 28px;font-size:14px;">Save</button>' +
        '<button onclick="hideSaveImagePopup()" class="clear-button" style="padding:10px 28px;font-size:14px;">Cancel</button>' +
        '</div></div>';
    
    // Center the popup
    popup.style.left = '50%';
    popup.style.top = '50%';
    popup.style.transform = 'translate(-50%, -50%)';
    popup.style.minWidth = '280px';
    
    overlay.style.display = 'block';
    popup.style.display = 'block';
}

function hideSaveImagePopup() {
    document.getElementById('context-menu-overlay').style.display = 'none';
    var popup = document.getElementById('context-menu');
    popup.style.display = 'none';
    popup.style.transform = '';
}

function confirmSaveImage(imgSrc) {
    var fileName = 'image_' + Date.now() + '.png';
    var fileType = 'image/png';
    
    // Check if already in cache
    var alreadyExists = imageCache.some(function(img) {
        return img.data === imgSrc;
    });
    
    if (!alreadyExists) {
        saveImageToCache({ name: fileName, type: fileType, data: imgSrc });
    }
    
    hideSaveImagePopup();
}

// Add enter key support for sending messages
messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Add enter key support for connecting
senderName.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        connectToServer();
    }
});

// Initialize button state
updateConnectionState(false);

// File attachment
var pendingFile = null;
var imageCache = JSON.parse(localStorage.getItem('imageCache') || '[]');

function showImageModal(src) {
    var modal = document.getElementById('image-modal');
    document.getElementById('modal-img').src = src;
    modal.style.display = 'flex';
}

function saveImageToCache(file) {
    if (!file.type.startsWith('image/')) return;
    // Avoid duplicates by checking data
    if (imageCache.some(function(img) { return img.data === file.data; })) return;
    imageCache.unshift({ name: file.name, type: file.type, data: file.data });
    // Keep max 20 images
    if (imageCache.length > 20) imageCache.pop();
    localStorage.setItem('imageCache', JSON.stringify(imageCache));
    renderImageCache();
}

function deleteFromCache(index) {
    imageCache.splice(index, 1);
    localStorage.setItem('imageCache', JSON.stringify(imageCache));
    renderImageCache();
}

function attachFromCache(index) {
    var img = imageCache[index];
    pendingFile = { name: img.name, type: img.type, data: img.data };
    var p = document.getElementById('file-preview');
    if (p) {
        p.innerHTML = '<img src="' + img.data + '" style="max-height:40px;vertical-align:middle;"> ' + img.name + ' <button onclick="pendingFile=null;this.parentElement.style.display=\'none\'">X</button>';
        p.style.display = 'block';
    }
    messageInput.focus();
}

function renderImageCache() {
    var container = document.getElementById('image-cache');
    if (!container) return;
    if (imageCache.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#6c757d;margin:0;">No cached images</p>';
        return;
    }
    container.innerHTML = imageCache.map(function(img, i) {
        return '<div class="cached-image-wrapper">' +
            '<img src="' + img.data + '" onclick="attachFromCache(' + i + ')" title="Click to attach: ' + img.name + '">' +
            '<button class="delete-btn" onclick="deleteFromCache(' + i + ')">X</button>' +
            '</div>';
    }).join('');
}

// Load cached images on start
renderImageCache();

// Toggle connection box minimize
function toggleConnectionBox() {
    var box = document.getElementById('connection-box');
    var btn = document.getElementById('minimize-btn');
    box.classList.toggle('minimized');
    btn.textContent = box.classList.contains('minimized') ? '+' : '−';
}

// Reply system
function setReply(id, content, sender) {
    replyingTo = { id: id, content: content, sender: sender };
    updateReplyPreview();
    messageInput.focus();
}

function cancelReply() {
    replyingTo = null;
    updateReplyPreview();
}

function updateReplyPreview() {
    var preview = document.getElementById('reply-preview');
    if (!preview) return;
    if (replyingTo) {
        var text = replyingTo.content ? replyingTo.content.substring(0, 60) : '[attachment]';
        if (replyingTo.content && replyingTo.content.length > 60) text += '...';
        var sender = replyingTo.sender === myConnection.name ? 'yourself' : replyingTo.sender;
        preview.innerHTML = '<div style="display:flex;flex-direction:column;gap:2px;"><span style="color:#007bff;font-weight:600;">↩ Replying to ' + sender + '</span><span style="color:#666;">' + text + '</span></div><button onclick="cancelReply()" style="padding:4px 10px;background:#dc3545;border-radius:4px;">✕</button>';
        preview.style.display = 'flex';
    } else {
        preview.style.display = 'none';
    }
}

messageInput.addEventListener('dragover', function(e) {
    e.preventDefault();
});

messageInput.addEventListener('drop', function(e) {
    e.preventDefault();
    var file = e.dataTransfer.files[0];
    if (!file) return;
    if (file.size > 5242880) { alert('Max 5MB'); return; }
    
    var reader = new FileReader();
    reader.onload = function(ev) {
        pendingFile = { name: file.name, type: file.type, data: ev.target.result };
        var p = document.getElementById('file-preview');
        if (p) {
            p.innerHTML = file.name + ' <button onclick="pendingFile=null;this.parentElement.style.display=\'none\'">X</button>';
            p.style.display = 'block';
        }
    };
    reader.readAsDataURL(file);
});