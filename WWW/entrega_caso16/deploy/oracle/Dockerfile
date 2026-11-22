# Imagen local de Oracle con Java para orapki. No contiene credenciales.
# Se fija la base que ya creó el volumen: no se cambia de versión de BD al repararlo.
FROM gvenzl/oracle-free:23-slim@sha256:48a3d9db7fa7c2a2fdbdf5fff7502c93e807349a2d625718fe61668cc3daa844

USER root
RUN microdnf install -y java-21-openjdk-headless \
    && microdnf clean all \
    && test -x /usr/lib/jvm/jre-21-openjdk/bin/java
# slim también elimina jlib. Oracle PKI 23.26 usa JCE del JRE y no necesita
# bibliotecas OSDT ni Crypto-J separadas para la wallet sin FIPS de este laboratorio.
ADD --checksum=sha256:d84b0dbb6880b1eef71f9271ce245b76e4d1df36baa72daf10f1bf1d490c8ae4 \
    https://repo.maven.apache.org/maven2/com/oracle/database/security/oraclepki/23.26.4.0.0/oraclepki-23.26.4.0.0.jar \
    ${ORACLE_HOME}/jlib/oraclepki.jar
RUN chmod 644 "$ORACLE_HOME/jlib/oraclepki.jar"
ENV JAVA_HOME=/usr/lib/jvm/jre-21-openjdk
USER oracle
RUN "$JAVA_HOME/bin/java" -version
