/*
 * aistack — JetBrains plugin build script.
 *
 * Targets the IntelliJ Platform Gradle Plugin v1.x (mature, stable on 2024–2026
 * IntelliJ builds). Build with:
 *
 *   ./gradlew buildPlugin            # produces build/distributions/aistack-*.zip
 *   ./gradlew runIde                 # launches a sandboxed IDE with the plugin
 *   ./gradlew verifyPlugin           # marketplace structure check
 *   ./gradlew publishPlugin          # requires PUBLISH_TOKEN env var (do NOT publish from CI without review)
 */

plugins {
  id("org.jetbrains.kotlin.jvm") version "1.9.22"
  id("org.jetbrains.intellij") version "1.17.3"
}

group = "com.aistack"
version = "0.1.0"

repositories {
  mavenCentral()
}

dependencies {
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")
}

intellij {
  version.set("2024.1")
  type.set("IC") // IntelliJ Community — broadest compatibility
  plugins.set(listOf("com.intellij.java"))
}

kotlin {
  jvmToolchain(17)
}

tasks {
  patchPluginXml {
    sinceBuild.set("241")
    untilBuild.set("251.*")
    changeNotes.set(
      """
        <ul>
          <li>0.1.0 — initial release: spawn agent action, agent activity tool window, REST client.</li>
        </ul>
      """.trimIndent()
    )
  }

  signPlugin {
    // Populate from env at publish time. Leave empty for local development.
    certificateChain.set(System.getenv("CERTIFICATE_CHAIN") ?: "")
    privateKey.set(System.getenv("PRIVATE_KEY") ?: "")
    password.set(System.getenv("PRIVATE_KEY_PASSWORD") ?: "")
  }

  publishPlugin {
    token.set(System.getenv("PUBLISH_TOKEN") ?: "")
  }
}
