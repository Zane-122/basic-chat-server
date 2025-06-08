import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Set;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;

import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

public class App {
    private static Set<WebSocket> connections = new HashSet<>();
    private static Map<String, String> users = new HashMap<>();

    private static WebSocketServer wsServer;

    public static void main(String[] args) throws Exception {
        try {
            // Create an HttpServer instance
            HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", 4000), 0);

            // Create a context for the server
            server.createContext("/", new PageHandler());
            server.createContext("/update-name", new UpdateNameHandler());

            // Create and start WebSocket server
            wsServer = new WebSocketServer(new InetSocketAddress("0.0.0.0", 4001)) {
                @Override
                public void onOpen(WebSocket conn, ClientHandshake handshake) {
                    // Check if the path is /ws
                    if (!handshake.getResourceDescriptor().equals("/ws")) {
                        conn.close(1008, "Invalid path");
                        return;
                    }
                    
                    String address = conn.getRemoteSocketAddress().toString();
                    // Convert IPv6 localhost to "localhost" but keep the port
                    if (address.contains("0:0:0:0:0:0:0:1")) {
                        String port = address.substring(address.lastIndexOf(":"));
                        address = "localhost" + port;
                    } else {
                        address = address.replace("/", "");
                    }
                    System.out.println("New connection: " + address);

                    // Add the new connection first
                    connections.add(conn);
                    
                    // Send the new client their address
                    conn.send("Your address: " + address);
                    
                    // Send the new client all existing connections with their names
                    for (Map.Entry<String, String> entry : users.entrySet()) {
                        JSONObject nameUpdate = new JSONObject();
                        nameUpdate.put("type", "name-update");
                        nameUpdate.put("address", entry.getKey());
                        nameUpdate.put("name", entry.getValue());
                        conn.send(nameUpdate.toString());
                    }
                    
                    // Send the new client all existing connections (except themselves)
                    for (WebSocket existingConn : connections) {
                        if (existingConn != conn) {
                            String existingAddress = existingConn.getRemoteSocketAddress().toString();
                            if (existingAddress.contains("0:0:0:0:0:0:0:1")) {
                                String port = existingAddress.substring(existingAddress.lastIndexOf(":"));
                                existingAddress = "localhost" + port;
                            } else {
                                existingAddress = existingAddress.replace("/", "");
                            }
                            conn.send("New connection: " + existingAddress);
                        }
                    }
                    
                    // Notify all other clients about the new connection
                    for (WebSocket client : connections) {
                        
                            client.send("New connection: " + address);
                        
                    }
                }

                @Override
                public void onClose(WebSocket conn, int code, String reason, boolean remote) {
                    String address = conn.getRemoteSocketAddress().toString();
                    // Convert IPv6 localhost to "localhost" but keep the port
                    if (address.contains("0:0:0:0:0:0:0:1")) {
                        String port = address.substring(address.lastIndexOf(":"));
                        address = "localhost" + port;
                    } else {
                        address = address.replace("/", "");
                    }
                    String addressWithoutPort = address.split(":")[0].trim();
                    
                    // Remove from connections set first
                    if (connections.contains(conn)) {
                        connections.remove(conn);
                    }
                    
                    // Then remove from users map
                    if (users.containsKey(addressWithoutPort)) {
                        users.remove(addressWithoutPort);
                    }

                    System.out.println("Remaining connections: " + connections.size());
                    System.out.println("Remaining users: " + users);

                    // Notify other clients about the disconnection
                    for (WebSocket client : connections) {
                        if (client != conn && client.isOpen()) {
                            client.send("Closed connection: " + address);
                        }
                    }
                }

                @Override
                public void onMessage(WebSocket conn, String message) {
                    System.out.println("Message from " + conn.getRemoteSocketAddress() + ": " + message);
                    for (WebSocket client : connections) {
                        client.send(message);
                    }
                }

                @Override
                public void onError(WebSocket conn, Exception ex) {
                    System.err.println("Error on connection " + conn.getRemoteSocketAddress() + ": " + ex.getMessage());
                }

                @Override
                public void onStart() {
                    System.out.println("WebSocket server started on port 4001");
                }
            };
            
            wsServer.start();

            // Start the HTTP server
            server.setExecutor(null);
            server.start();

            System.out.println("HTTP server started at http://localhost:4000/");
        } catch (Exception e) {
            System.err.println("Error starting server: " + e.getMessage());
            e.printStackTrace();
        }
    }

    static class PageHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String path = exchange.getRequestURI().getPath();
            String filePath;
            String contentType;

            if (path.equals("/script.js")) {
                filePath = "src/Resources/script.js";
                contentType = "application/javascript";
            } else {
                filePath = "src/Resources/Index.html";
                contentType = "text/html";
            }
            
            // Set content type
            exchange.getResponseHeaders().set("Content-Type", contentType);
            
            // Read file content
            String response = new String(Files.readAllBytes(Paths.get(filePath)));
            
            exchange.sendResponseHeaders(200, response.length());
            OutputStream os = exchange.getResponseBody();
            os.write(response.getBytes());
            os.close();
        }
    }

    static class UpdateNameHandler implements HttpHandler{ 
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String requestBody = new String(exchange.getRequestBody().readAllBytes());
            System.out.println(requestBody);

            JSONObject json = new JSONObject(requestBody);
            System.out.println("address: " + json.get("address"));
            
            users.put(json.get("address").toString(), json.get("name").toString());
            System.out.println("THESE ARE THE USERS: " + users);

            JSONObject responseJson = new JSONObject();
            responseJson.put("type", "update-name");
            responseJson.put("address", json.get("address"));
            responseJson.put("name", json.get("name"));

            for (WebSocket client : connections) {
                if (client.isOpen()) {
                    client.send(responseJson.toString());
                }
            }

            // Send a response back to the client
            String response = "Name updated successfully";
            exchange.sendResponseHeaders(200, response.length());
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(response.getBytes());
            }
        }
    }
}
