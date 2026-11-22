package cl.bec;

import graphql.*;
import graphql.analysis.*;
import graphql.execution.*;
import graphql.execution.instrumentation.*;
import graphql.schema.idl.*;
import graphql.schema.visibility.NoIntrospectionGraphqlFieldVisibility;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.*;
import static cl.bec.Problem.require;

public final class GraphQLGateway extends Node {
    private final GraphQL graph;
    public GraphQLGateway(Config c,Clock clock) throws Exception {
        super(c,clock,false);
        String sdl=new String(Objects.requireNonNull(getClass().getResourceAsStream("/schema.graphqls")).readAllBytes(),StandardCharsets.UTF_8);
        var wiring=RuntimeWiring.newRuntimeWiring().fieldVisibility(NoIntrospectionGraphqlFieldVisibility.NO_INTROSPECTION_FIELD_VISIBILITY)
            .type("Query",b->b.dataFetcher("account",env->{
                Request request=env.getGraphQlContext().get("request");
                String owner=env.getArgument("readerId");if(owner==null) owner=request.user.id();
                request.user.owner(owner);require(owner.matches("r-[A-Za-z0-9-]{1,80}"),400,"READER_REQUIRED","Indique un lector válido.");
                int first=env.getArgument("first"),page=env.getArgument("page");
                require(first>=1&&first<=20&&page>=0&&page<=1000,400,"PAGINATION","first: 1–20; page: 0–1000.");
                @SuppressWarnings("unchecked") Map<String,Object> cache=env.getGraphQlContext().get("cache");
                String key="account:"+owner+":"+first+":"+page;
                final String reader=owner;
                synchronized(cache) {
                    if(cache.containsKey(key)) return cache.get(key);
                    var profile=rpc("clients","GET","/readers/"+reader,null,request.user,request.correlation);
                    String params="?readerId="+URLEncoder.encode(reader,StandardCharsets.UTF_8)+"&size="+first+"&page="+page;
                    var loans=rpc("orders","GET","/loans"+params,null,request.user,request.correlation);
                    var reservations=rpc("orders","GET","/reservations"+params,null,request.user,request.correlation);
                    var rows=Json.rows(loans.get("items"));
                    var source=Json.map("reader",profile,"loans",rows,"reservations",reservations.get("items"),"totalLoans",loans.get("total"),
                        "page",page,"hasMore",(page+1)*first>0&&(page+1)*first<Json.integer(loans,"total",0),"sanctionUntil",loans.get("sanctionUntil"));
                    List<String> docIds=rows.stream().flatMap(l->Json.rows(l.get("items")).stream()).map(i->Json.str(i,"documentId")).distinct().toList();
                    List<String> loanIds=rows.stream().map(l->Json.str(l,"id")).toList();
                    String batch=Crypto.sha(key);
                    for(var loan:rows) {
                        loan.put("_batch",batch);
                        for(var item:Json.rows(loan.get("items"))) item.put("_batch",batch);
                    }
                    cache.put("docIds:"+batch,docIds);cache.put("loanIds:"+batch,loanIds);
                    cache.put(key,source);return source;
                }
            }))
            .type("Reader",b->{
                for(String name:List.of("email","address","telephone","rut")) b.dataFetcher(name,env->{
                    Request request=env.getGraphQlContext().get("request");
                    @SuppressWarnings("unchecked") Map<String,Object> source=env.getSource();
                    require(request.user.role().equals("ADMIN")||request.user.id().equals(Json.str(source,"id")),403,"FIELD_FORBIDDEN","Campo de contacto reservado al titular y administrativo.");
                    return source.get(name);
                });
                return b;
            })
            .type("LoanItem",b->b.dataFetcher("document",env->{
                @SuppressWarnings("unchecked") Map<String,Object> source=env.getSource();
                return batch(env.getGraphQlContext(),"documents",Json.str(source,"_batch")).get(Json.str(source,"documentId"));
            }))
            .type("Loan",b->b.dataFetcher("assessment",env->{
                @SuppressWarnings("unchecked") Map<String,Object> source=env.getSource();
                return batch(env.getGraphQlContext(),"assessments",Json.str(source,"_batch")).get(Json.str(source,"id"));
            })).build();
        var schema=new SchemaGenerator().makeExecutableSchema(new SchemaParser().parse(sdl),wiring);
        DataFetcherExceptionHandler handler=params->{
            Throwable exception=params.getException();
            while(exception.getCause()!=null && !(exception instanceof Problem)) exception=exception.getCause();
            Problem problem=exception instanceof Problem p?p:new Problem(500,"INTERNAL","No se pudo resolver este campo.");
            var error=GraphqlErrorBuilder.newError().message(problem.getMessage()).path(params.getPath()).location(params.getSourceLocation())
                .extensions(Map.of("code",problem.code)).build();
            return CompletableFuture.completedFuture(DataFetcherExceptionHandlerResult.newResult().error(error).build());
        };
        graph=GraphQL.newGraphQL(schema).defaultDataFetcherExceptionHandler(handler)
            .instrumentation(new ChainedInstrumentation(List.of(new MaxQueryDepthInstrumentation(6),new MaxQueryComplexityInstrumentation(100)))).build();
    }
    @SuppressWarnings("unchecked")
    private Map<String,Map<String,Object>> batch(GraphQLContext context,String type,String batch) {
        Request request=context.get("request");Map<String,Object> cache=context.get("cache");
        String key=type+":"+batch;
        Object result;
        synchronized(cache) {
            result=cache.get(key);
            if(result==null) {
                try {
                    boolean documents=type.equals("documents");
                    var reply=rpc(documents?"inventory":"payments","POST",documents?"/documents/batch":"/assessments/batch",
                        documents?Json.map("ids",cache.get("docIds:"+batch)):Json.map("loanIds",cache.get("loanIds:"+batch)),request.user,request.correlation);
                    var byId=new HashMap<String,Map<String,Object>>();
                    for(var row:Json.rows(reply.get("items"))) byId.put(Json.str(row,"id"),row);
                    result=byId;
                } catch(Problem e) {result=e;}
                cache.put(key,result);
            }
        }
        if(result instanceof Problem p) throw p;
        return (Map<String,Map<String,Object>>)result;
    }
    @Override protected Reply handle(Request r) {
        r.callers("gateway");r.user.roles("READER","LIBRARIAN","ADMIN");
        require(r.path.equals("/graphql")&&r.method.equals("POST"),404,"NOT_FOUND","Operación GraphQL no publicada.");
        var b=r.json();Validation.fields(b,"query","variables","operationName");
        String query=Validation.text(b,"query",5,8192);
        require(b.get("variables")==null||b.get("variables") instanceof Map<?,?>,400,"VALIDATION","variables debe ser objeto.");
        require(Json.write(b.get("variables")).length()<=4096,400,"VARIABLES_LIMIT","Variables demasiado extensas.");
        @SuppressWarnings("unchecked") var variables=(Map<String,Object>)b.getOrDefault("variables",Map.of());
        var input=ExecutionInput.newExecutionInput().query(query).variables(variables==null?Map.of():variables)
            .graphQLContext(Map.of("request",r,"cache",new ConcurrentHashMap<String,Object>()));
        if(b.get("operationName")!=null) input.operationName(Validation.text(b,"operationName",1,80));
        return Reply.ok(graph.execute(input.build()).toSpecification());
    }
}
