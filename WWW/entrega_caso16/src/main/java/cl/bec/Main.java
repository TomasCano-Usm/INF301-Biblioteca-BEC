package cl.bec;

import java.nio.file.Path;
import java.time.Clock;
import java.util.concurrent.CountDownLatch;

public final class Main {
    public static Node create(Config config,Clock clock) throws Exception {
        return switch(config.name) {
            case "secrets" -> new SecretManager(config,clock);
            case "gateway" -> new ApiGateway(config,clock);
            case "auth" -> new AuthService(config,clock);
            case "clients" -> new ClientsService(config,clock);
            case "inventory" -> new InventoryService(config,clock);
            case "orders" -> new OrdersService(config,clock);
            case "payments" -> new PaymentsService(config,clock);
            case "notifications" -> new NotificationService(config,clock);
            case "graphql" -> new GraphQLGateway(config,clock);
            case "mail" -> new MailTestProvider(config,clock);
            default -> throw new IllegalArgumentException("Servicio desconocido");
        };
    }
    public static void main(String[] args) throws Exception {
        if(args.length>0&&args[0].equals("contracts")) {System.out.println(Json.write(Routes.ALL));return;}
        if(args.length!=2) {System.err.println("Uso: java -jar bec.jar <servicio> <directorio-runtime>");System.exit(2);}
        Node node=create(new Config(Path.of(args[1]),args[0]),Clock.systemUTC());node.start();
        Runtime.getRuntime().addShutdownHook(new Thread(node::close));
        System.out.println(Json.write(Json.map("event","started","service",args[0],"port",node.config.port(),"tls",true)));
        new CountDownLatch(1).await();
    }
}
