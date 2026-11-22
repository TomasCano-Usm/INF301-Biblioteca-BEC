FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src src
RUN mvn -B -ntp -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/bec.jar /app/bec.jar
COPY web /app/web
USER 1000:1000
ENTRYPOINT ["java","-Xms24m","-Xmx160m","-XX:ActiveProcessorCount=2","-jar","/app/bec.jar"]
