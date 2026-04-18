pipeline {
  agent any

  environment {
    // Use the system-installed Node and NPM
    PATH = "/usr/bin:/usr/local/bin:$PATH"
    NODE_ENV = 'production'
  }

  stages {
    stage('Checkout Code') {
      steps {
        git branch: 'prod',
            url: 'https://github.com/PANACEA-IT-SERVICES-PVT-LTD/eg-backend.git',
            credentialsId: 'github-private'
      }
    }

    stage('Install & Build') {
      steps {
        dir('/home/royalarjunff01/eg-backend') {
          sh 'npm install'
          sh 'npm run build'
        }
      }
    }

    stage('Prisma Migrate & PM2 Restart') {
      steps {
        dir('/home/royalarjunff01/eg-backend') {
          sh 'npx prisma migrate deploy'
          sh 'pm2 restart all'
        }
      }
    }
  }

  post {
    success {
      echo '✅ Build and deploy successful.'
    }
    failure {
      echo '❌ Build or deploy failed.'
    }
  }
}
