import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.Set;

import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import org.json.JSONObject;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

public class App {
    private static Set<WebSocket> connections = new HashSet<>();
    private static WebSocketServer wsServer;

    public static void main(String[] args) throws Exception {
        try {
            // Create an HttpServer instance
            HttpServer server = HttpServer.create(new InetSocketAddress(4000), 0);

            // Create a context for the server
            server.createContext("/", new PageHandler());
            server.createContext("/addConnection", new AddConnectionHandler());
            server.createContext("/removeConnection", new RemoveConnectionHandler());

            // Create and start WebSocket server
            wsServer = new WebSocketServer(new InetSocketAddress(4001)) {
                @Override
                public void onOpen(WebSocket conn, ClientHandshake handshake) {
                    connections.add(conn);
                    String address = conn.getRemoteSocketAddress().toString();
                    // Convert IPv6 localhost to "localhost" but keep the port
                    if (address.contains("0:0:0:0:0:0:0:1")) {
                        String port = address.substring(address.lastIndexOf(":"));
                        address = "localhost" + port;
                    } else {
                        address = address.replace("/", "");
                    }
                    System.out.println("New connection: " + address);

                    // Send the new client all existing connections
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

                    // Notify all clients about the new connection
                    for (WebSocket client : connections) {
                        client.send("New connection: " + address);
                    }
                }

                @Override
                public void onClose(WebSocket conn, int code, String reason, boolean remote) {
                    connections.remove(conn);
                    String address = conn.getRemoteSocketAddress().toString();
                    // Convert IPv6 localhost to "localhost" but keep the port
                    if (address.contains("0:0:0:0:0:0:0:1")) {
                        String port = address.substring(address.lastIndexOf(":"));
                        address = "localhost" + port;
                    } else {
                        address = address.replace("/", "");
                    }
                    System.out.println("Closed connection: " + address);

                    for (WebSocket client : connections) {
                        client.send("Closed connection: " + address);
                    }
                }

                @Override
                public void onMessage(WebSocket conn, String message) {
                    System.out.println("Message from " + conn.getRemoteSocketAddress() + ": " + message);
                    // Broadcast message to all connected clients
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

    static class AddConnectionHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            InputStream requestBody = exchange.getRequestBody();
            String body = new String(requestBody.readAllBytes());

            JSONObject json = new JSONObject(body);

            String address = json.getString("address");

            for (WebSocket client : connections) {
                client.send("New connection: " + address);
            }

            exchange.sendResponseHeaders(200, 0);
            OutputStream responseBody = exchange.getResponseBody();
            responseBody.close();
        }
    }

    static class RemoveConnectionHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            InputStream requestBody = exchange.getRequestBody();
            String body = new String(requestBody.readAllBytes());

            JSONObject json = new JSONObject(body);

            String address = json.getString("address");

            for (WebSocket client : connections) {
                client.send("Closed connection: " + address);
            }

            exchange.sendResponseHeaders(200, 0);
            OutputStream responseBody = exchange.getResponseBody();
            responseBody.close();
        }
    }
}
